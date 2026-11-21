import { expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  writer.record({
    agent: "a-1",
    at: Date.now(),
    breaker: null,
    cost: null,
    model: "claude-haiku-5-5",
    ms: 1,
    nextTarget: null,
    profile: null,
    session: "s-1",
    slot: answer.slot,
    status: 200,
    target: "omniroute:side-query",
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
it("plain Claude supersedes a backend in both command rows", async () => {
  const home = tempDir("plain-answer");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: home });
  const writer = createHistoryWriter({
    file: paths.historyDbFile,
    flushAfterMs: 60_000,
    log: () => {},
    retentionDays: () => 90,
  });
  for (const target of ["omniroute:glm", "anthropic"])
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
        target,
        tokens: null,
      });
  writer.close();
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => {
    lines.push(line);
  };
  const env = { ANTHROPIC_BASE_URL: "http://127.0.0.1:47812" };
  try {
    await runStatusline(
      paths,
      async () => JSON.stringify({ ...input, session_id: "s-1" }),
      Date.now(),
      env,
    );
    await runSubagentStatusline(
      async () =>
        JSON.stringify({
          session_id: "s-1",
          tasks: [{ id: "a-1", model: answer.model, effort: "high" }],
        }),
      paths,
      env,
    );
  } finally {
    console.log = log;
  }
  expect(lines).toEqual([
    "Sonnet 5.5",
    '{"content":"worker → claude-sonnet-5-5 → high","id":"a-1"}',
  ]);
});
it("an unset gateway URL never pins backend effort in a direct session", async () => {
  const home = tempDir("direct-effort");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: home });
  mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
  writeFileSync(
    paths.gatewayConfigFile,
    JSON.stringify({
      version: 1,
      aliases: {},
      backends: { omniroute: { apiKey: "k", baseUrl: "http://127.0.0.1:47813" } },
      slots: { "cc-smart-dev-kit-worker": ["omniroute:glm"] },
      effort: { "cc-smart-dev-kit-worker": { "omniroute:glm": "xhigh" } },
    }),
    { mode: 0o600 },
  );
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => {
    lines.push(line);
  };
  try {
    const read = async () =>
      JSON.stringify({
        ...input,
        effort: { level: "low" },
        context_window: {
          context_window_size: 200000,
          used_percentage: 10,
          current_usage: {
            input_tokens: 20000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });
    await runStatusline(paths, read, Date.now(), {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:47812",
    });
    await runStatusline(paths, read, Date.now(), {});
  } finally {
    console.log = log;
  }
  expect(lines).toEqual([
    "Sonnet 5.5 · ctx 20k · 10% of 200k · xhigh",
    "Sonnet 5.5 · ctx 20k · 10% of 200k · low",
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
  expect(text({ ...answer, target: "claude-sonnet-5-5-20261001" })).toBe("Sonnet 5.5");
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
it.each(["anthropic (server tool web_search)", "router (server tool web_search; anthropic 529)"])(
  "router words never become a model: %s",
  (target) => {
    const value = { ...answer, target };
    expect(
      statuslineText(
        input,
        null,
        10,
        "UTC",
        85,
        { gatewayOn: true, profile: null },
        undefined,
        value,
      ),
    ).toBe("Sonnet 5.5");
    expect(
      subagentRows(
        { tasks: [{ id: "a-1", model: answer.model, effort: "high" }] },
        new Map([["a-1", value]]),
      ),
    ).toEqual([{ id: "a-1", content: "worker → claude-sonnet-5-5 → high" }]);
  },
);
it("gateway off never accesses the history path", async () => {
  const home = tempDir("off-history");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: home });
  Object.defineProperty(paths, "historyDbFile", {
    get() {
      throw new Error("history accessed while off");
    },
  });
  const log = console.log;
  console.log = () => {};
  try {
    await runStatusline(
      paths,
      async () => JSON.stringify({ ...input, session_id: "s-1" }),
      Date.now(),
      { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    );
    await runSubagentStatusline(
      async () =>
        JSON.stringify({ session_id: "s-1", tasks: [{ id: "a-1", model: answer.model }] }),
      paths,
      { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    );
  } finally {
    console.log = log;
  }
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
