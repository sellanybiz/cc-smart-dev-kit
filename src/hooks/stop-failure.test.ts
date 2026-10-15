/**
 * The StopFailure hook: which stops get an alert, what it offers, and how the worker shows
 * it. The inputs are the ones Claude Code 2.1.300 sent in the live test
 * (docs/claude-code-contract.md). The entry runs as a subprocess with a fake `notify-send`
 * first on PATH; its stdout must stay empty.
 */
import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GatewayConfig } from "../gateway/config";
import type { LimitState } from "../gateway/limit-state";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { type Alert, type AlertContext, planAlert, type Run, runAlert } from "./stop-failure";

const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);
const RESET = NOW / 1000 + 3 * 3600;
const ENTRY = join(import.meta.dir, "..", "entries", "stop-failure.ts");

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
    nowMs: NOW,
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
    expect(planAlert(AT_LIMIT, ctx({ config: null }))).toBeNull();
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
      planAlert(AT_LIMIT, ctx({ state: state("claude-sonnet-5-5", 1000) }))?.action,
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
  const PATHS = { bunPath: "/usr/bin/bun", cliBundle: "/plugin/dist/cli.js" };

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

  it("Linux, the person clicks the action: the slot command runs, then a note says so", () => {
    const fake = fakeRunner([
      { exitCode: 0, stdout: "use\n" },
      { exitCode: 0, stdout: "" },
    ]);
    expect(runAlert(ALERT, "linux", PATHS, fake.run)).toBe("used");
    expect(fake.runs.map((run) => run.argv)).toEqual([
      [
        "notify-send",
        "--app-name=anymodel",
        "--action=use=Use m1 until it resets",
        "--action=wait=Wait",
        "Claude usage limit reached",
        "body text",
      ],
      [
        "/usr/bin/bun",
        "/plugin/dist/cli.js",
        "gateway",
        "slot",
        "opus",
        "claude-opus-5-5,omniroute:m1",
      ],
      [
        "notify-send",
        "--app-name=anymodel",
        "Fallback on",
        "Using m1 until it resets: anymodel gateway status shows it.",
      ],
    ]);
  });

  it("Linux, Wait or no click: nothing runs", () => {
    const wait = fakeRunner([{ exitCode: 0, stdout: "wait\n" }]);
    expect(runAlert(ALERT, "linux", PATHS, wait.run)).toBe("waited");
    expect(wait.runs).toHaveLength(1);
    const gone = fakeRunner([{ exitCode: null, stdout: "", timedOut: true }]);
    expect(runAlert(ALERT, "linux", PATHS, gone.run)).toBe("no answer");
    expect(gone.runs).toHaveLength(1);
  });

  it("Linux, the slot command fails: a note with the command to run by hand", () => {
    const fake = fakeRunner([
      { exitCode: 0, stdout: "use" },
      { exitCode: 1, stdout: "" },
    ]);
    expect(runAlert(ALERT, "linux", PATHS, fake.run)).toBe("use failed");
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
    expect(runAlert(ALERT, "linux", PATHS, old.run)).toBe("shown");
    expect(old.runs[1]?.argv).toEqual([
      "notify-send",
      "--app-name=anymodel",
      "Claude usage limit reached",
      "body text",
    ]);
    const mac = fakeRunner([{ exitCode: 0, stdout: "" }]);
    expect(runAlert({ ...ALERT, body: 'say "hi" \\ there' }, "darwin", PATHS, mac.run)).toBe(
      "shown",
    );
    expect(mac.runs[0]?.argv).toEqual([
      "osascript",
      "-e",
      'display notification "say \\"hi\\" \\\\ there" with title "Claude usage limit reached"',
    ]);
    const none = fakeRunner([]);
    expect(runAlert(ALERT, "win32", PATHS, none.run)).toBe("no notifier");
    expect(none.runs).toEqual([]);
  });
});

describe("the hook as Claude Code runs it", () => {
  /** A temp HOME with a gateway config, the router's state, and a fake notify-send. */
  function machine(withConfig: boolean) {
    const home = tempDir("stop-failure");
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    if (withConfig) {
      mkdirSync(join(home, ".config", "anymodel"), { recursive: true });
      writeFileSync(join(home, ".config", "anymodel", "gateway.json"), JSON.stringify(config()), {
        mode: 0o600,
      });
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
    const run = (input: unknown) => {
      const guard = subprocessGuard();
      return Bun.spawnSync([process.execPath, ...guard.args, ENTRY], {
        env: { CLAUDE_CONFIG_DIR: claudeDir, HOME: home, PATH: bin, ...guard.env },
        stdin: new Blob([typeof input === "string" ? input : JSON.stringify(input)]),
        stderr: "pipe",
        stdout: "pipe",
      });
    };
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

  it("at the limit: prints nothing, exits 0, and the detached worker shows the alert", async () => {
    const m = machine(true);
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

  it("a short rate limit, no gateway, or a broken input: prints nothing, exits 0, no alert", async () => {
    for (const [withConfig, input] of [
      [true, SHORT],
      [false, AT_LIMIT],
      [true, "{not json"],
    ] as const) {
      const m = machine(withConfig);
      const result = m.run(input);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
      await Bun.sleep(300);
      expect(existsSync(m.log)).toBe(false);
    }
  });
});
