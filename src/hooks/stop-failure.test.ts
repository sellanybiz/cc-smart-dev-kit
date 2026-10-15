/**
 * The StopFailure hook: which stops get an alert, what it offers, and how the worker shows
 * it. The inputs are the ones Claude Code 2.1.300 sent in the live test
 * (docs/claude-code-contract.md). The entry runs as a subprocess with a fake `notify-send`
 * first on PATH and a fake launcher that runs this CLI's source; its stdout must stay empty.
 */
import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import type { GatewayConfig } from "../gateway/config";
import type { LimitState } from "../gateway/limit-state";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import {
  type Alert,
  type AlertContext,
  parseAlert,
  planAlert,
  type Run,
  readAlertContext,
  runAlert,
} from "./stop-failure";

const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);
const RESET = NOW / 1000 + 3 * 3600;
const ENTRY = join(import.meta.dir, "..", "entries", "stop-failure.ts");
const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/** The hook input at the plan's limit, as seen live. */
const AT_LIMIT = {
  cwd: "/home/user/my-app",
  error: "rate_limit",
  hook_event_name: "StopFailure",
  last_assistant_message: "You've hit your limit · resets 1:42am (Asia/Karachi)",
  session_id: "e84162c9",
};

/** The hook input at a short rate limit: also `rate_limit`, other words. */
const SHORT = {
  ...AT_LIMIT,
  last_assistant_message:
    "API Error: Server is temporarily limiting requests (not your usage limit) · This request would exceed your organization's rate limit of 50 requests per minute.",
};

function config(extra: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
    port: 20199,
    slots: {
      "anymodel-scout": ["omniroute:ollama-cloud/deepseek-v4.1-flash", "claude-sonnet-5-5"],
      "anymodel-worker": ["omniroute:ollama-cloud/glm-5.3-flash", "claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 60_000 },
    version: 1,
    ...extra,
  };
}

/** A worker slot with two cheap targets and Claude last. */
function twoCheap(): GatewayConfig {
  return config({
    slots: {
      ...config().slots,
      "anymodel-worker": [
        "omniroute:ollama-cloud/deepseek-v4.1-flash",
        "omniroute:ollama-cloud/glm-5.3-flash",
        "claude-sonnet-5-5",
      ],
    },
  });
}

function state(model: string, seenAgoMs: number): LimitState {
  return {
    fallbacks: {},
    limits: { [model]: { claim: "five_hour", resetsAt: RESET, seenAt: NOW - seenAgoMs } },
    version: 1,
  };
}

function ctx(extra: Partial<AlertContext> = {}): AlertContext {
  return {
    config: config(),
    gatewayOn: true,
    gatewaySetUp: true,
    nowMs: NOW,
    sessionModel: null,
    state: state("claude-opus-5-5", 5_000),
    timeZone: "UTC",
    ...extra,
  };
}

describe("which stops get an alert", () => {
  it("the plan limit on Opus: an alert that offers the Opus slot with the worker's cheap model", () => {
    expect(planAlert(AT_LIMIT, ctx())).toEqual({
      action: {
        args: ["gateway", "slot", "opus", "claude-opus-5-5,omniroute:ollama-cloud/glm-5.3-flash"],
        label: "Use glm-5.3-flash until it resets",
      },
      body: "claude-opus-5-5: five_hour, resets 13:00. A cheaper model until it resets: anymodel gateway slot opus claude-opus-5-5,omniroute:ollama-cloud/glm-5.3-flash (Claude takes over again by itself once it answers).",
      title: "Claude usage limit reached",
    });
  });

  it("a short rate limit, another error, or no gateway: no alert", () => {
    expect(planAlert(SHORT, ctx({ state: null }))).toBeNull();
    // Its words win even over a fresh plan limit in the router's state.
    expect(planAlert(SHORT, ctx())).toBeNull();
    // The router's state explains a stop only while it is fresh (two minutes).
    expect(planAlert(SHORT, ctx({ state: state("claude-opus-5-5", 3 * 60_000) }))).toBeNull();
    expect(planAlert({ ...AT_LIMIT, error: "server_error" }, ctx())).toBeNull();
    expect(planAlert("not an object", ctx())).toBeNull();
    // A person who never set the gateway up does not notice the plugin.
    expect(planAlert(AT_LIMIT, ctx({ config: null, gatewaySetUp: false }))).toBeNull();
  });

  it("a gateway.json that cannot be read: the plain alert, no action", () => {
    expect(planAlert(AT_LIMIT, ctx({ config: null }))).toEqual({
      action: null,
      body: "claude-opus-5-5: five_hour, resets 13:00. Claude Code continues by itself after the reset. The gateway config cannot be read, so no fallback is offered: anymodel doctor says why.",
      title: "Claude usage limit reached",
    });
  });

  it("the router's fresh state is enough, whatever the words", () => {
    expect(
      planAlert({ ...AT_LIMIT, last_assistant_message: "API Error: 429" }, ctx()),
    ).not.toBeNull();
  });

  it("no action when the model has no slot, the slot is already on, or the gateway is off", () => {
    expect(planAlert(AT_LIMIT, ctx({ state: null }))).toEqual({
      action: null,
      body: "Claude: plan limit, resets 1:42am. Claude Code continues by itself after the reset.",
      title: "Claude usage limit reached",
    });
    expect(
      planAlert(
        AT_LIMIT,
        ctx({ sessionModel: "claude-sonnet-5-5", state: state("claude-sonnet-5-5", 1000) }),
      )?.action,
    ).toBeNull();
    const on = config({
      modelSlots: { "claude-opus-5-5": "anymodel-opus" },
      slots: {
        ...config().slots,
        "anymodel-opus": ["claude-opus-5-5", "omniroute:ollama-cloud/glm-5.3-flash"],
      },
    });
    expect(planAlert(AT_LIMIT, ctx({ config: on }))).toEqual({
      action: null,
      body: "claude-opus-5-5: five_hour, resets 13:00. The anymodel-opus fallback is on, yet this turn stopped: check anymodel gateway status.",
      title: "Claude usage limit reached",
    });
    expect(planAlert(AT_LIMIT, ctx({ gatewayOn: false }))).toEqual({
      action: null,
      body: "claude-opus-5-5: five_hour, resets 13:00. To use a cheaper model until it resets: anymodel gateway slot opus claude-opus-5-5,omniroute:ollama-cloud/glm-5.3-flash",
      title: "Claude usage limit reached",
    });
  });

  it("an account-wide limit offers every cheap target of the worker slot, in order", () => {
    expect(planAlert(AT_LIMIT, ctx({ config: twoCheap() }))?.action).toEqual({
      args: [
        "gateway",
        "slot",
        "opus",
        "claude-opus-5-5,omniroute:ollama-cloud/deepseek-v4.1-flash,omniroute:ollama-cloud/glm-5.3-flash",
      ],
      label: "Use deepseek-v4.1-flash until it resets",
    });
  });

  it("an Opus-only limit (seven_day_opus) offers Sonnet first, then the cheap targets", () => {
    const opusOnly: LimitState = {
      fallbacks: {},
      limits: {
        "claude-opus-5-5": { claim: "seven_day_opus", resetsAt: RESET, seenAt: NOW - 5_000 },
      },
      version: 1,
    };
    expect(planAlert(AT_LIMIT, ctx({ config: twoCheap(), state: opusOnly }))).toEqual({
      action: {
        args: [
          "gateway",
          "slot",
          "opus",
          "claude-opus-5-5,claude-sonnet-5-5,omniroute:ollama-cloud/deepseek-v4.1-flash,omniroute:ollama-cloud/glm-5.3-flash",
        ],
        label: "Use claude-sonnet-5-5 until it resets",
      },
      body: "claude-opus-5-5: seven_day_opus, resets 13:00. A cheaper model until it resets: anymodel gateway slot opus claude-opus-5-5,claude-sonnet-5-5,omniroute:ollama-cloud/deepseek-v4.1-flash,omniroute:ollama-cloud/glm-5.3-flash (Claude takes over again by itself once it answers).",
      title: "Claude usage limit reached",
    });
  });

  it("the session's own model picks the limit record; else the freshest Opus or Fable one", () => {
    const three: LimitState = {
      fallbacks: {},
      limits: {
        "claude-fable-5-1": { claim: "five_hour", resetsAt: RESET, seenAt: NOW - 10 * 60_000 },
        "claude-opus-5-5": { claim: "seven_day", resetsAt: RESET, seenAt: NOW - 5_000 },
        "claude-sonnet-5-5": { claim: "five_hour", resetsAt: RESET, seenAt: NOW - 1_000 },
      },
      version: 1,
    };
    // A Fable session: its own record, though an Opus one is fresher.
    expect(
      planAlert(AT_LIMIT, ctx({ sessionModel: "claude-fable-5-1[1m]", state: three }))?.action
        ?.args,
    ).toEqual([
      "gateway",
      "slot",
      "fable",
      "claude-fable-5-1,omniroute:ollama-cloud/glm-5.3-flash",
    ]);
    // A Sonnet session: its own record, and no slot to offer.
    expect(
      planAlert(AT_LIMIT, ctx({ sessionModel: "claude-sonnet-5-5", state: three }))?.body,
    ).toBe(
      "claude-sonnet-5-5: five_hour, resets 13:00. Claude Code continues by itself after the reset.",
    );
    // No model from the transcript: the freshest record of a model with a model slot.
    expect(planAlert(AT_LIMIT, ctx({ state: three }))?.action?.args).toEqual([
      "gateway",
      "slot",
      "opus",
      "claude-opus-5-5,omniroute:ollama-cloud/glm-5.3-flash",
    ]);
  });

  it("readAlertContext: the session model from the input's transcript_path; a broken gateway.json is still set up", () => {
    const home = tempDir("alert-context");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(join(home, ".config", "anymodel"), { recursive: true });
    writeFileSync(paths.gatewayConfigFile, "{not json", { mode: 0o600 });
    const transcript = join(home, "session.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { model: "claude-fable-5-1" }, type: "assistant" })}\n`,
    );
    const read = readAlertContext(paths, NOW, { ...AT_LIMIT, transcript_path: transcript });
    expect(read).toEqual({
      config: null,
      gatewayOn: false,
      gatewaySetUp: true,
      nowMs: NOW,
      sessionModel: "claude-fable-5-1",
      state: null,
    });
  });
});

describe("the worker shows it", () => {
  const ALERT: Alert = {
    action: {
      args: ["gateway", "slot", "opus", "claude-opus-5-5,omniroute:m1"],
      label: "Use m1 until it resets",
    },
    body: "body text",
    title: "Claude usage limit reached",
  };
  const LAUNCHER = "/home/user/.local/bin/anymodel";

  function fakeRunner(answers: { exitCode: null | number; stdout: string; timedOut?: boolean }[]) {
    const runs: Run[] = [];
    const run = (one: Run) => {
      runs.push(one);
      const answer = answers[runs.length - 1] ?? { exitCode: 0, stdout: "" };
      return {
        exitCode: answer.exitCode,
        stdout: answer.stdout,
        timedOut: answer.timedOut ?? false,
      };
    };
    return { run, runs };
  }

  it("Linux, the person clicks the action: the slot command runs through the launcher, then a note says so", () => {
    const fake = fakeRunner([
      { exitCode: 0, stdout: "use\n" },
      { exitCode: 0, stdout: "" },
    ]);
    expect(runAlert(ALERT, "linux", LAUNCHER, fake.run)).toBe("used");
    expect(fake.runs.map((run) => run.argv)).toEqual([
      [
        "notify-send",
        "--app-name=anymodel",
        "--action=use=Use m1 until it resets",
        "--action=wait=Wait",
        "Claude usage limit reached",
        "body text",
      ],
      [LAUNCHER, "gateway", "slot", "opus", "claude-opus-5-5,omniroute:m1"],
      [
        "notify-send",
        "--app-name=anymodel",
        "Fallback on",
        "Using m1 until it resets: anymodel gateway status shows it. Send a message in Claude Code to go on now.",
      ],
    ]);
  });

  it("Linux, Wait or no click: nothing runs", () => {
    const wait = fakeRunner([{ exitCode: 0, stdout: "wait\n" }]);
    expect(runAlert(ALERT, "linux", LAUNCHER, wait.run)).toBe("waited");
    expect(wait.runs).toHaveLength(1);
    const gone = fakeRunner([{ exitCode: null, stdout: "", timedOut: true }]);
    expect(runAlert(ALERT, "linux", LAUNCHER, gone.run)).toBe("no answer");
    expect(gone.runs).toHaveLength(1);
  });

  it("Linux, the slot command fails: a note with the command to run by hand", () => {
    const fake = fakeRunner([
      { exitCode: 0, stdout: "use" },
      { exitCode: 1, stdout: "" },
    ]);
    expect(runAlert(ALERT, "linux", LAUNCHER, fake.run)).toBe("use failed");
    expect(fake.runs.at(-1)?.argv).toEqual([
      "notify-send",
      "--app-name=anymodel",
      "Fallback not turned on",
      "Run it yourself to see why: anymodel gateway slot opus claude-opus-5-5,omniroute:m1",
    ]);
  });

  it("a notify-send without --action: the plain notification instead; macOS: osascript; others: none", () => {
    const old = fakeRunner([
      { exitCode: 1, stdout: "" },
      { exitCode: 0, stdout: "" },
    ]);
    expect(runAlert(ALERT, "linux", LAUNCHER, old.run)).toBe("shown");
    expect(old.runs[1]?.argv).toEqual([
      "notify-send",
      "--app-name=anymodel",
      "Claude usage limit reached",
      "body text",
    ]);
    const mac = fakeRunner([{ exitCode: 0, stdout: "" }]);
    expect(runAlert({ ...ALERT, body: 'say "hi" \\ there' }, "darwin", LAUNCHER, mac.run)).toBe(
      "shown",
    );
    expect(mac.runs[0]?.argv).toEqual([
      "osascript",
      "-e",
      'display notification "say \\"hi\\" \\\\ there" with title "Claude usage limit reached"',
    ]);
    const none = fakeRunner([]);
    expect(runAlert(ALERT, "win32", LAUNCHER, none.run)).toBe("no notifier");
    expect(none.runs).toEqual([]);
  });

  it("parseAlert reads the hook's JSON back, and nothing else", () => {
    expect(parseAlert(JSON.stringify(ALERT))).toEqual(ALERT);
    expect(parseAlert(JSON.stringify({ ...ALERT, action: null }))).toEqual({
      ...ALERT,
      action: null,
    });
    expect(parseAlert("{not json")).toBeNull();
    expect(parseAlert(JSON.stringify({ ...ALERT, action: { args: [1], label: "x" } }))).toBeNull();
    expect(parseAlert(JSON.stringify({ body: "b" }))).toBeNull();
  });
});

describe("the hook as Claude Code runs it", () => {
  /**
   * A temp HOME with a gateway config (or none, or one that is not JSON), the router's
   * state, a fake notify-send, and (unless `launcher` is false) a fake launcher in
   * `~/.local/bin` that runs this CLI's source, as the real one runs the installed version.
   */
  function machine(gateway: "broken" | "none" | "ok", launcher = true) {
    const home = tempDir("stop-failure");
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    if (gateway !== "none") {
      mkdirSync(join(home, ".config", "anymodel"), { recursive: true });
      writeFileSync(
        join(home, ".config", "anymodel", "gateway.json"),
        gateway === "ok" ? JSON.stringify(config()) : "{not json",
        { mode: 0o600 },
      );
      writeFileSync(
        join(claudeDir, "settings.json"),
        JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
      );
    }
    mkdirSync(join(home, ".local", "state", "anymodel"), { recursive: true });
    const seen = Date.now() - 5_000;
    writeFileSync(
      join(home, ".local", "state", "anymodel", "gateway-state.json"),
      JSON.stringify({
        fallbacks: {},
        limits: {
          "claude-opus-5-5": {
            claim: "five_hour",
            resetsAt: Math.floor(seen / 1000) + 3600,
            seenAt: seen,
          },
        },
        version: 1,
      }),
    );
    const bin = join(home, "bin");
    mkdirSync(bin);
    const log = join(home, "notify.log");
    // Logs each call's arguments, one per line, then answers "wait".
    writeFileSync(
      join(bin, "notify-send"),
      `#!/bin/sh\nfor a in "$@"; do echo "$a" >> '${log}'; done\necho --- >> '${log}'\necho wait\n`,
    );
    chmodSync(join(bin, "notify-send"), 0o755);
    const guard = subprocessGuard();
    if (launcher) {
      mkdirSync(join(home, ".local", "bin"), { recursive: true });
      const words = [process.execPath, ...guard.args, CLI].map((word) => `'${word}'`).join(" ");
      writeFileSync(join(home, ".local", "bin", "anymodel"), `#!/bin/sh\nexec ${words} "$@"\n`);
      chmodSync(join(home, ".local", "bin", "anymodel"), 0o755);
    }
    const run = (input: unknown) =>
      Bun.spawnSync([process.execPath, ...guard.args, ENTRY], {
        env: { CLAUDE_CONFIG_DIR: claudeDir, HOME: home, PATH: bin, ...guard.env },
        stdin: new Blob([typeof input === "string" ? input : JSON.stringify(input)]),
        stderr: "pipe",
        stdout: "pipe",
      });
    return { log, run };
  }

  async function waitFor(path: string): Promise<string> {
    for (let tries = 0; tries < 100; tries += 1) {
      if (existsSync(path) && readFileSync(path, "utf8").includes("---"))
        return readFileSync(path, "utf8");
      await Bun.sleep(50);
    }
    throw new Error(`${path} did not appear within 5 s`);
  }

  it("at the limit: prints nothing, exits 0, and the worker the launcher runs shows the alert", async () => {
    const m = machine("ok");
    const result = m.run(AT_LIMIT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "--app-name=anymodel",
      "--action=use=Use glm-5.3-flash until it resets",
      "--action=wait=Wait",
      "Claude usage limit reached",
    ]);
  });

  it("no launcher: a plain notification, with no action and no long wait", async () => {
    const m = machine("ok", false);
    expect(m.run(AT_LIMIT).exitCode).toBe(0);
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 2)).toEqual(["--app-name=anymodel", "Claude usage limit reached"]);
  });

  it("a gateway.json that is not JSON: still the plain alert", async () => {
    const m = machine("broken");
    expect(m.run(AT_LIMIT).exitCode).toBe(0);
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 2)).toEqual(["--app-name=anymodel", "Claude usage limit reached"]);
    // The reset time is the machine's clock: only the start and the end are fixed.
    expect(lines[2]).toStartWith("claude-opus-5-5: five_hour, resets ");
    expect(lines[2]).toEndWith(
      "Claude Code continues by itself after the reset. The gateway config cannot be read, so no fallback is offered: anymodel doctor says why.",
    );
  });

  it("a short rate limit, no gateway, or a broken input: prints nothing, exits 0, no alert", async () => {
    for (const [gateway, input] of [
      ["ok", SHORT],
      ["none", AT_LIMIT],
      ["ok", "{not json"],
    ] as const) {
      const m = machine(gateway);
      const result = m.run(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
      await Bun.sleep(300);
      expect(existsSync(m.log)).toBe(false);
    }
  });
});
