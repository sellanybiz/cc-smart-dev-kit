/**
 * The StopFailure hook: which stops get an alert, what it says (which limit and when it resets,
 * and never an offer — owner, 2026-10-25), and how it is shown. The inputs are the ones Claude
 * Code 2.1.300 sent in the live test (docs/claude-code-contract.md). The entry runs as a
 * subprocess with a fake `notify-send` first on PATH; its stdout must stay empty.
 */
import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import type { GatewayConfig } from "../gateway/config";
import type { LimitState } from "../gateway/limit-state";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import {
  type Alert,
  type AlertContext,
  BREAKER_ALERT_FILE,
  breakerAlert,
  limitAlertDesktop,
  parseAlert,
  planAlert,
  type Run,
  readAlertContext,
  runAlert,
  stopFailureWillAlert,
} from "./stop-failure";
import { decodedToastText } from "./windows-toast";

// This file starts the hook's entry as a real process: its own speed limit.
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

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
      "cc-smart-dev-kit-scout": ["omniroute:ollama-cloud/deepseek-v4.1-flash", "claude-sonnet-5-5"],
      "cc-smart-dev-kit-worker": ["omniroute:ollama-cloud/glm-5.3-flash", "claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 60_000 },
    version: 1,
    ...extra,
  };
}

/** A worker slot with two affordable targets and Claude last. */
function twoAffordable(): GatewayConfig {
  return config({
    slots: {
      ...config().slots,
      "cc-smart-dev-kit-worker": [
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

const BREAKER_SLOT = "cc-smart-dev-kit-worker";
/** When the breaker opened: 09:40, twenty minutes before NOW. */
const BREAKER_SINCE = NOW - 20 * 60_000;

/** The hook input on the router's breaker 429, as a subscription shows it (research § 6). */
const BREAKER = {
  ...AT_LIMIT,
  last_assistant_message: `API Error: Server is temporarily limiting requests (not your usage limit) · cc-smart-dev-kit-router: every target of ${BREAKER_SLOT} is limited or down since 09:40 (omniroute:ollama-cloud/glm-5.3-flash: HTTP 429, until 10:07); change it: cc-smart-dev-kit gateway slot worker <targets>`,
};

/** The state file with the worker's breaker open; `lastAt` fresh unless a test says otherwise. */
function breaker(extra: { lastAt?: number; since?: number } = {}): LimitState {
  return {
    breakers: {
      [BREAKER_SLOT]: {
        held: 3,
        lastAt: extra.lastAt ?? NOW - 5_000,
        since: extra.since ?? BREAKER_SINCE,
        targets: [
          { status: 429, target: "omniroute:ollama-cloud/glm-5.3-flash", until: NOW + 7 * 60_000 },
          {
            status: 503,
            target: "omniroute:ollama-cloud/deepseek-v4.1-flash",
            until: NOW + 9 * 60_000,
          },
        ],
      },
    },
    fallbacks: {},
    limits: {},
    version: 1,
  };
}

/** The alerts settings at their defaults: every moment alerts, and no sound (`workflow`). */
function alerts(extra: Partial<AlertContext["alerts"]> = {}): AlertContext["alerts"] {
  return {
    events: { source: "default", value: ["needs-you", "question", "finished", "failed"] },
    sound: { source: "default", value: false },
    usagePercent: { source: "default", value: 85 },
    ...extra,
  };
}

function ctx(extra: Partial<AlertContext> = {}): AlertContext {
  return {
    alerts: alerts(),
    alertsProblem: null,
    breakerAlerted: {},
    config: config(),
    gatewayOn: true,
    gatewaySetUp: true,
    nowMs: NOW,
    sessionModel: null,
    state: state("claude-opus-5-5", 5_000),
    timeZone: "UTC",
    watchdogOn: false,
    ...extra,
  };
}

/** The line a plan limit gets when no slot fact explains the stop: which limit, when it resets. */
const PLAIN_OPUS =
  "claude-opus-5-5: five_hour, resets 13:00. Claude Code continues by itself after the reset.";

/**
 * Words that would offer something to do: a model, a chain, a fallback switch, the gateway, a
 * button. The owner's rule (2026-10-25): a usage-limit alert has none of them.
 */
const OFFER_WORDS = [
  "gateway on",
  "gateway slot",
  "gateway fallback",
  "gateway profile",
  "gateway project",
  "launch --gateway",
  "until it resets",
  "affordable",
  "To use",
  "turn the gateway",
];

describe("which stops get an alert", () => {
  it("the plan limit on Opus: which limit and when it resets, and nothing to do", () => {
    // The owner's rule (2026-10-25): no model, no chain, no fallback switch, no `gateway on`,
    // no button. The opus slot has no chain here; the person's worker chain is not offered.
    expect(planAlert(AT_LIMIT, ctx())).toEqual({
      body: PLAIN_OPUS,
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

  it("a gateway.json that cannot be read: the same plain alert", () => {
    expect(planAlert(AT_LIMIT, ctx({ config: null }))).toEqual({
      body: PLAIN_OPUS,
      title: "Claude usage limit reached",
    });
  });

  it("the router's fresh state is enough, whatever the words", () => {
    expect(
      planAlert({ ...AT_LIMIT, last_assistant_message: "API Error: 429" }, ctx()),
    ).not.toBeNull();
  });

  it("the model has no family, or its slot answers some other way, or the fallback is on: a plain fact, no offer", () => {
    expect(planAlert(AT_LIMIT, ctx({ state: null }))).toEqual({
      body: "Claude: plan limit, resets 1:42am. Claude Code continues by itself after the reset.",
      title: "Claude usage limit reached",
    });
    // A Claude id of no family the router knows has no slot.
    expect(
      planAlert(
        AT_LIMIT,
        ctx({ sessionModel: "claude-mystery-1", state: state("claude-mystery-1", 1000) }),
      ),
    ).toEqual({
      body: "claude-mystery-1: five_hour, resets 13:00. Claude Code continues by itself after the reset.",
      title: "Claude usage limit reached",
    });
    // The worker's chain starts with a backend: Claude was not its first answer.
    expect(
      planAlert(
        AT_LIMIT,
        ctx({ sessionModel: "claude-sonnet-5-5", state: state("claude-sonnet-5-5", 1000) }),
      ),
    ).toEqual({
      body: "claude-sonnet-5-5: five_hour, resets 13:00. cc-smart-dev-kit-worker answers from omniroute:ollama-cloud/glm-5.3-flash first, yet this turn stopped: check cc-smart-dev-kit gateway status.",
      title: "Claude usage limit reached",
    });
    // The opus chain and its switch on, in 0.5.0's own field (no `modelSlots`).
    const on = config({
      fallback: { "cc-smart-dev-kit-opus": true },
      slots: {
        ...config().slots,
        "cc-smart-dev-kit-opus": ["claude-opus-5-5", "omniroute:ollama-cloud/glm-5.3-flash"],
      },
    });
    expect(planAlert(AT_LIMIT, ctx({ config: on }))).toEqual({
      body: "claude-opus-5-5: five_hour, resets 13:00. The cc-smart-dev-kit-opus fallback is on, yet this turn stopped: check cc-smart-dev-kit gateway status.",
      title: "Claude usage limit reached",
    });
    // The opus chain starts with a backend: Opus was not asked first.
    const backendFirst = config({
      slots: {
        ...config().slots,
        "cc-smart-dev-kit-opus": ["omniroute:ollama-cloud/glm-5.3-flash"],
      },
    });
    expect(planAlert(AT_LIMIT, ctx({ config: backendFirst }))?.body).toBe(
      "claude-opus-5-5: five_hour, resets 13:00. cc-smart-dev-kit-opus answers from omniroute:ollama-cloud/glm-5.3-flash first, yet this turn stopped: check cc-smart-dev-kit gateway status.",
    );
  });

  it("owner 2026-10-25: whatever the chains hold, the alert offers no model, no chain, no switch and no button", () => {
    const opusOnly: LimitState = {
      fallbacks: {},
      limits: {
        "claude-opus-5-5": { claim: "seven_day_opus", resetsAt: RESET, seenAt: NOW - 5_000 },
      },
      version: 1,
    };
    const judge = {
      slots: { ...twoAffordable().slots, "cc-smart-dev-kit-judge": ["omniroute:judge-model"] },
    };
    const plain = "Claude Code continues by itself after the reset.";
    for (const [what, given] of [
      ["no opus chain, two affordable worker targets", ctx({ config: twoAffordable() })],
      ["a judge chain beside them", ctx({ config: config(judge) })],
      ["an Opus-only window", ctx({ config: twoAffordable(), state: opusOnly })],
      [
        "an opus chain of one Claude target",
        ctx({
          config: config({
            slots: { ...config().slots, "cc-smart-dev-kit-opus": ["claude-opus-4-8"] },
          }),
        }),
      ],
      [
        "an opus chain of two with its fallback off",
        ctx({
          config: config({
            slots: {
              ...config().slots,
              "cc-smart-dev-kit-opus": ["claude-opus-5-5", "omniroute:ollama-cloud/glm-5.3-flash"],
            },
          }),
        }),
      ],
      ["a fresh setup: a backend and no chain", ctx({ config: config({ slots: {} }) })],
    ] as const) {
      const alert = planAlert(AT_LIMIT, given);
      expect({ what, keys: Object.keys(alert ?? {}).sort() }).toEqual({
        what,
        keys: ["body", "title"],
      });
      expect({ what, body: alert?.body.endsWith(plain) }).toEqual({ what, body: true });
      for (const word of OFFER_WORDS) {
        expect({ what, word, said: alert?.body.includes(word) }).toEqual({
          what,
          word,
          said: false,
        });
      }
    }
    // The model named is the one that hit the limit: no other model id comes from the plugin.
    const alert = planAlert(AT_LIMIT, ctx({ config: twoAffordable(), state: opusOnly }));
    expect(alert).toEqual({
      body: "claude-opus-5-5: seven_day_opus, resets 13:00. Claude Code continues by itself after the reset.",
      title: "Claude usage limit reached",
    });
    expect(JSON.stringify(alert)).not.toContain("claude-sonnet");
  });

  it("RV4 finding 3: a session off the gateway — by its project or its launch — gets the plain line, whatever the machine's chains", () => {
    // The chains below answer a session on the gateway; this one is on the login, so a fact
    // about them is not true of it, and the alert never says `gateway on` (it changes nothing
    // on a machine that is on) or any other switch.
    const backendFirst = config({
      slots: {
        ...config().slots,
        "cc-smart-dev-kit-opus": ["omniroute:ollama-cloud/glm-5.3-flash"],
      },
    });
    expect(planAlert(AT_LIMIT, ctx({ config: backendFirst, gatewayOn: false }))).toEqual({
      body: PLAIN_OPUS,
      title: "Claude usage limit reached",
    });
    // The same chains for a session on the gateway: the fact is true of it.
    expect(planAlert(AT_LIMIT, ctx({ config: backendFirst }))?.body).toContain(
      "cc-smart-dev-kit-opus answers from omniroute:ollama-cloud/glm-5.3-flash first",
    );
    // Off, with a config it can offer from: still no offer.
    for (const word of OFFER_WORDS) {
      expect(planAlert(AT_LIMIT, ctx({ gatewayOn: false }))?.body.includes(word)).toBe(false);
    }
  });

  it("the session's own model picks the limit record; else the freshest one with a family slot", () => {
    const three: LimitState = {
      fallbacks: {},
      limits: {
        "claude-fable-5-1": { claim: "five_hour", resetsAt: RESET, seenAt: NOW - 10 * 60_000 },
        "claude-mystery-1": { claim: "five_hour", resetsAt: RESET, seenAt: NOW - 1_000 },
        "claude-opus-5-5": { claim: "seven_day", resetsAt: RESET, seenAt: NOW - 5_000 },
      },
      version: 1,
    };
    // A Fable session: its own record, though an Opus one is fresher.
    expect(
      planAlert(AT_LIMIT, ctx({ sessionModel: "claude-fable-5-1[1m]", state: three }))?.body,
    ).toBe(
      "claude-fable-5-1: five_hour, resets 13:00. Claude Code continues by itself after the reset.",
    );
    // No model from the transcript: the freshest record whose family has a slot (the mystery
    // id has none, though it is fresher).
    expect(planAlert(AT_LIMIT, ctx({ state: three }))?.body).toBe(
      "claude-opus-5-5: seven_day, resets 13:00. Claude Code continues by itself after the reset.",
    );
  });

  it("readAlertContext: the session model from the input's transcript_path; a broken gateway.json is still set up", () => {
    const home = tempDir("alert-context");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(paths.gatewayConfigFile, "{not json", { mode: 0o600 });
    const transcript = join(home, "session.jsonl");
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { model: "claude-fable-5-1" }, type: "assistant" })}\n`,
    );
    const read = readAlertContext(paths, NOW, { ...AT_LIMIT, transcript_path: transcript }, {});
    expect(read).toEqual({
      alerts: alerts(),
      alertsProblem: null,
      breakerAlerted: {},
      config: null,
      gatewayOn: false,
      gatewaySetUp: true,
      nowMs: NOW,
      sessionModel: "claude-fable-5-1",
      state: null,
      watchdogOn: false,
    });
  });

  describe("RF1-2: the session's own gateway, from the hook's environment", () => {
    /** A machine whose user file points at the router and whose config has the profile `cheap`. */
    function machineOn(): ReturnType<typeof cliPaths> {
      const home = tempDir("alert-session");
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
      mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
      writeFileSync(
        paths.gatewayConfigFile,
        JSON.stringify(
          config({
            profiles: {
              cheap: {
                slots: { "cc-smart-dev-kit-opus": ["omniroute:ollama-cloud/glm-5.3-flash"] },
              },
            },
          }),
        ),
        { mode: 0o600 },
      );
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(
        paths.settingsFile,
        JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
      );
      return paths;
    }

    it("the project is off while the user file is on: the session is off, and its alert is the plain line", () => {
      const read = readAlertContext(machineOn(), NOW, AT_LIMIT, {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      });
      expect(read.gatewayOn).toBe(false);
      // No URL at all reaches Anthropic too.
      expect(readAlertContext(machineOn(), NOW, AT_LIMIT, {}).gatewayOn).toBe(false);
      // RV4 finding 3, the owner's way (2026-10-25): the machine's file points at the router, and
      // this session does not use it — the alert is which limit and when it resets, with no
      // `gateway on`, no `gateway project on` and no chain, because none is offered.
      expect(planAlert(AT_LIMIT, { ...ctx(), ...read, state: ctx().state })).toEqual({
        body: PLAIN_OPUS,
        title: "Claude usage limit reached",
      });
    });

    it("the session points at the router while the user file says nothing: on", () => {
      const home = tempDir("alert-session-on");
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
      mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
      writeFileSync(paths.gatewayConfigFile, JSON.stringify(config()), { mode: 0o600 });
      const read = readAlertContext(paths, NOW, AT_LIMIT, {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:20199",
      });
      expect(read.gatewayOn).toBe(true);
    });

    it("a profile's URL: the profile's chains decide which slot fact is true of this session", () => {
      const read = readAlertContext(machineOn(), NOW, AT_LIMIT, {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:20199/p/cheap",
      });
      expect(read.gatewayOn).toBe(true);
      expect(read.config?.slots["cc-smart-dev-kit-opus"]).toEqual([
        "omniroute:ollama-cloud/glm-5.3-flash",
      ]);
      // The profile's opus chain answers from a backend first: the alert says so, as for a
      // machine chain that does.
      expect(planAlert(AT_LIMIT, { ...ctx(), ...read, state: ctx().state })?.body).toBe(
        "claude-opus-5-5: five_hour, resets 13:00. cc-smart-dev-kit-opus answers from omniroute:ollama-cloud/glm-5.3-flash first, yet this turn stopped: check cc-smart-dev-kit gateway status.",
      );
    });

    it("a profile name the config lacks answers as plain Claude, and the alert offers no command for it", () => {
      const read = readAlertContext(machineOn(), NOW, AT_LIMIT, {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:20199/p/nope",
      });
      // A name the config lacks answers as plain Claude, as the router does: no slot is known.
      expect([read.gatewayOn, read.config?.slots]).toEqual([true, {}]);
      // The alert once offered `gateway profile nope slot …` for a profile that is not there
      // (RV4 hunch, `…/p/nope`); it offers no command at all now.
      const alert = planAlert(AT_LIMIT, { ...ctx(), ...read, state: ctx().state });
      expect(alert).toEqual({ body: PLAIN_OPUS, title: "Claude usage limit reached" });
      expect(JSON.stringify(alert)).not.toContain("nope");
    });
  });

  it("readAlertContext: the alert settings come from the folder the session is in", () => {
    const home = tempDir("alert-context");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(
      paths.workflowConfigFile,
      `${JSON.stringify({ alerts: { events: ["needs-you"], sound: true } }, null, 2)}\n`,
    );
    const read = readAlertContext(paths, NOW, { ...AT_LIMIT, cwd: home });
    expect(read.alerts.events).toEqual({ source: "personal", value: ["needs-you"] });
    expect(read.alerts.sound.value).toBe(true);
    expect(read.alertsProblem).toBeNull();
  });

  it("a `failed` moment left out of alerts.events: no alert at all", () => {
    expect(
      planAlert(
        AT_LIMIT,
        ctx({ alerts: alerts({ events: { source: "project", value: ["finished"] } }) }),
      ),
    ).toBeNull();
    expect(planAlert(AT_LIMIT, ctx())).not.toBeNull();
  });

  it("a broken workflow file: the alert goes on, with the line about the fallback", () => {
    const home = tempDir("alert-context");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, "{ not json");
    const read = readAlertContext(paths, NOW, { ...AT_LIMIT, cwd: home });
    expect(read.alerts.events.source).toBe("default");
    expect(read.alertsProblem).toStartWith(
      "cc-smart-dev-kit: the alerts use the settings that can be read (Invalid ",
    );
    // The alert itself is unchanged: the settings only fell back, they did not break it.
    expect(
      planAlert(AT_LIMIT, ctx({ alerts: read.alerts, alertsProblem: read.alertsProblem })),
    ).not.toBeNull();
  });

  it("a background session: stopFailureWillAlert is false, so the notifier stays out too", () => {
    // A background session inherits the daemon's display, so the alert it would show goes to
    // a desktop the person is not looking at: agent view alerts for it instead
    // (`background-session.ts`).
    const home = tempDir("alert-context");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(paths.gatewayConfigFile, JSON.stringify(config()), { mode: 0o600 });
    const deps = {
      env: { DISPLAY: ":0" },
      nowMs: NOW,
      paths,
      platform: "linux" as const,
      which: (command: string) => (command === "notify-send" ? "/usr/bin/notify-send" : null),
    };
    expect(stopFailureWillAlert(AT_LIMIT, deps)).toBe(true);
    expect(
      stopFailureWillAlert(AT_LIMIT, {
        ...deps,
        env: { CLAUDE_JOB_DIR: join(home, "job"), DISPLAY: ":0" },
      }),
    ).toBe(false);
  });
});

describe("the breaker's 429", () => {
  const HEAD =
    "cc-smart-dev-kit-worker: every target limited or down since 09:40 (omniroute:ollama-cloud/glm-5.3-flash HTTP 429 until 10:07; omniroute:ollama-cloud/deepseek-v4.1-flash HTTP 503 until 10:09).";

  it("one alert per opening: the slot, since when, each target's reason, and what happens next", () => {
    expect(breakerAlert(BREAKER, ctx({ state: breaker() }))).toEqual({
      alert: {
        body: `${HEAD} Then send a message to go on.`,
        title: "Gateway slot limited",
      },
      mark: BREAKER_SLOT,
      since: BREAKER_SINCE,
      slot: BREAKER_SLOT,
    });
    // The mark says the person already heard about this opening: no second alert.
    expect(
      breakerAlert(
        BREAKER,
        ctx({ breakerAlerted: { [BREAKER_SLOT]: BREAKER_SINCE }, state: breaker() }),
      ),
    ).toBeNull();
  });

  it("a profile's breaker is its own record: its message says the profile, its mark is its key", () => {
    const text = `API Error: Server is temporarily limiting requests (not your usage limit) · cc-smart-dev-kit-router: every target of ${BREAKER_SLOT} in profile my-project is limited or down since 09:40 (omniroute:ollama-cloud/glm-5.3-flash: HTTP 429, until 10:07); change it: the chain of worker under profiles.my-project in gateway.json`;
    const input = { ...BREAKER, last_assistant_message: text };
    const state: LimitState = {
      ...breaker(),
      breakers: {
        [`my-project/${BREAKER_SLOT}`]: breaker().breakers?.[BREAKER_SLOT] ?? {
          held: 0,
          lastAt: 0,
          since: 0,
          targets: [],
        },
      },
    };
    const alert = breakerAlert(input, ctx({ state }));
    expect(alert).toEqual({
      alert: {
        // The facts only (owner, 2026-10-25): the profile, since when, each target and why. The
        // router's own message already names the command that changes the chain.
        body: `cc-smart-dev-kit-worker in profile my-project: every target limited or down since 09:40 (omniroute:ollama-cloud/glm-5.3-flash HTTP 429 until 10:07; omniroute:ollama-cloud/deepseek-v4.1-flash HTTP 503 until 10:09). Then send a message to go on.`,
        title: "Gateway slot limited",
      },
      mark: `my-project/${BREAKER_SLOT}`,
      since: BREAKER_SINCE,
      slot: BREAKER_SLOT,
    });
    // The mark is the profile's key: the machine's own opening is a different one.
    expect(
      breakerAlert(
        input,
        ctx({ breakerAlerted: { [`my-project/${BREAKER_SLOT}`]: BREAKER_SINCE }, state }),
      ),
    ).toBeNull();
    expect(
      breakerAlert(input, ctx({ breakerAlerted: { [BREAKER_SLOT]: BREAKER_SINCE }, state }))?.mark,
    ).toBe(`my-project/${BREAKER_SLOT}`);
  });

  it("a new opening alerts again, with its own since", () => {
    const next = breakerAlert(
      BREAKER,
      ctx({
        breakerAlerted: { [BREAKER_SLOT]: BREAKER_SINCE },
        state: breaker({ since: BREAKER_SINCE + 60_000 }),
      }),
    );
    expect(next?.alert.body).toStartWith(
      "cc-smart-dev-kit-worker: every target limited or down since 09:41 (",
    );
  });

  it("a stale record, another error, no gateway, or another stop: no alert", () => {
    // A stopped router leaves its record behind; 15 minutes without it being touched is stale.
    expect(
      breakerAlert(BREAKER, ctx({ state: breaker({ lastAt: NOW - 16 * 60_000 }) })),
    ).toBeNull();
    expect(
      breakerAlert({ ...BREAKER, error: "server_error" }, ctx({ state: breaker() })),
    ).toBeNull();
    expect(breakerAlert(BREAKER, ctx({ gatewaySetUp: false, state: breaker() }))).toBeNull();
    expect(breakerAlert(SHORT, ctx())).toBeNull();
    expect(breakerAlert(BREAKER, ctx({ state: null }))).toBeNull();
    // The breaker's 429 is no plan limit: the plan alert never takes it.
    expect(planAlert(BREAKER, ctx({ state: breaker() }))).toBeNull();
  });

  it("the watchdog on: Claude Code goes on by itself; off: then send a message to go on", () => {
    const off = breakerAlert(BREAKER, ctx({ state: breaker() }));
    expect(off?.alert.body).toEndWith("Then send a message to go on.");
    const on = breakerAlert(BREAKER, ctx({ state: breaker(), watchdogOn: true }));
    expect(on?.alert.body).toEndWith("Claude Code goes on by itself.");
  });

  it("an API key's 429: the router's message is found after `Request rejected (429)`", () => {
    const apiKey = {
      ...BREAKER,
      last_assistant_message: `API Error: Request rejected (429) · cc-smart-dev-kit-router: every target of ${BREAKER_SLOT} is limited or down since 09:40 (omniroute:ollama-cloud/glm-5.3-flash: HTTP 429, until 10:07)`,
    };
    expect(breakerAlert(apiKey, ctx({ state: breaker() }))?.alert.title).toBe(
      "Gateway slot limited",
    );
  });

  it("owner 2026-10-25: whatever the chains and the session, the alert offers no model, no chain, no switch and no button", () => {
    const claudeOnly = config({ slots: { [BREAKER_SLOT]: ["claude-sonnet-5-5"] } });
    const plain = { body: `${HEAD} Then send a message to go on.`, title: "Gateway slot limited" };
    for (const [what, given] of [
      ["the machine's own chains, backends in them", ctx({ state: breaker() })],
      ["a chain with no backend target", ctx({ config: claudeOnly, state: breaker() })],
      ["a gateway.json that cannot be read", ctx({ config: null, state: breaker() })],
      // The gateway off, or the session off it by its project: `gateway on` changes nothing for
      // the second, and neither is told to turn anything on.
      ["the gateway off", ctx({ gatewayOn: false, state: breaker() })],
    ] as const) {
      const alert = breakerAlert(BREAKER, given)?.alert;
      expect({ what, alert }).toEqual({ what, alert: plain });
      for (const word of OFFER_WORDS) {
        expect({ what, word, said: alert?.body.includes(word) }).toEqual({
          what,
          word,
          said: false,
        });
      }
    }
  });

  it("a `failed` moment left out of alerts.events: no breaker alert", () => {
    expect(
      breakerAlert(
        BREAKER,
        ctx({
          alerts: alerts({ events: { source: "project", value: ["finished"] } }),
          state: breaker(),
        }),
      ),
    ).toBeNull();
  });

  it("the mark is read back, so a second hook run knows the opening", () => {
    const home = tempDir("breaker-mark");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      join(paths.stateDir, BREAKER_ALERT_FILE),
      JSON.stringify({ [BREAKER_SLOT]: BREAKER_SINCE }),
    );
    const read = readAlertContext(paths, NOW, BREAKER);
    expect(read.breakerAlerted).toEqual({ [BREAKER_SLOT]: BREAKER_SINCE });
    // Another slot's mark, or one that is not a number, does not spoil it.
    writeFileSync(
      join(paths.stateDir, BREAKER_ALERT_FILE),
      JSON.stringify({ [BREAKER_SLOT]: "old", "cc-smart-dev-kit-scout": 5 }),
    );
    expect(readAlertContext(paths, NOW, BREAKER).breakerAlerted).toEqual({
      "cc-smart-dev-kit-scout": 5,
    });
  });
});

describe("the plain notification", () => {
  const ALERT: Alert = { body: "body text", title: "Claude usage limit reached" };

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

  it("owner 2026-10-25: no button on any platform — Linux notify-send, macOS osascript, Windows a toast, others none", () => {
    const linux = fakeRunner([{ exitCode: 0, stdout: "" }]);
    expect(runAlert(ALERT, "linux", linux.run)).toBe("shown");
    // One plain call: no `--action`, nothing to wait for, no command run afterwards.
    expect(linux.runs).toEqual([
      {
        argv: [
          "notify-send",
          "--app-name=cc-smart-dev-kit",
          "Claude usage limit reached",
          "body text",
        ],
        timeoutMs: 10_000,
      },
    ]);
    const mac = fakeRunner([{ exitCode: 0, stdout: "" }]);
    expect(runAlert({ ...ALERT, body: 'say "hi" \\ there' }, "darwin", mac.run)).toBe("shown");
    expect(mac.runs[0]?.argv).toEqual([
      "osascript",
      "-e",
      'display notification "say \\"hi\\" \\\\ there" with title "Claude usage limit reached"',
    ]);
    // Windows: the same words as macOS, as a toast.
    const win = fakeRunner([{ exitCode: 0, stdout: "" }]);
    expect(runAlert(ALERT, "win32", win.run)).toBe("shown");
    expect(win.runs[0]?.argv.slice(0, 4)).toEqual([
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    const script = Buffer.from(win.runs[0]?.argv[4] ?? "", "base64").toString("utf16le");
    expect(decodedToastText(script, "title")).toBe("Claude usage limit reached");
    expect(decodedToastText(script, "body")).toBe("body text");
    const none = fakeRunner([]);
    expect(runAlert(ALERT, "freebsd", none.run)).toBe("no notifier");
    expect(none.runs).toEqual([]);
  });

  it("the desktop route: notify-send with a display on Linux, osascript on macOS, PowerShell on Windows", () => {
    const found = (names: string[]) => (command: string) =>
      names.includes(command) ? `/usr/bin/${command}` : null;
    expect(limitAlertDesktop("linux", { DISPLAY: ":0" }, found(["notify-send"]))).toBe(true);
    expect(limitAlertDesktop("linux", {}, found(["notify-send"]))).toBe(false);
    expect(limitAlertDesktop("darwin", {}, found(["osascript"]))).toBe(true);
    expect(limitAlertDesktop("win32", {}, found(["powershell"]))).toBe(true);
    expect(limitAlertDesktop("win32", {}, found(["notify-send", "osascript"]))).toBe(false);
    expect(limitAlertDesktop("freebsd", {}, found(["notify-send"]))).toBe(false);
  });

  it("parseAlert reads the hook's JSON back, and nothing else; an older hook's action is dropped", () => {
    expect(parseAlert(JSON.stringify(ALERT))).toEqual(ALERT);
    // An older hook, still running in a session begun before an update, may hand the worker an
    // alert with a button. It is shown as the plain alert it is now: the action is not read, so
    // no click can run a command.
    const older = {
      ...ALERT,
      action: {
        commands: [["gateway", "fallback", "opus", "on"]],
        label: "Use m1 until it resets",
      },
    };
    expect(parseAlert(JSON.stringify(older))).toEqual(ALERT);
    expect(parseAlert(JSON.stringify({ ...ALERT, action: null }))).toEqual(ALERT);
    expect(parseAlert("{not json")).toBeNull();
    expect(parseAlert(JSON.stringify({ body: "b" }))).toBeNull();
    expect(parseAlert(JSON.stringify({ title: "t" }))).toBeNull();
    expect(parseAlert("[]")).toBeNull();
  });
});

describe("the hook as Claude Code runs it", () => {
  /**
   * A temp HOME with a gateway config (or none, or one that is not JSON), the router's
   * state (a plan limit, or an open breaker), and a fake notify-send that logs its arguments.
   */
  function machine(
    gateway: "broken" | "none" | "ok",
    extraEnv: Record<string, string> = {},
    routerState: "breaker" | "limit" = "limit",
  ) {
    const home = tempDir("stop-failure");
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    if (gateway !== "none") {
      mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
      writeFileSync(
        join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
        gateway === "ok" ? JSON.stringify(config()) : "{not json",
        { mode: 0o600 },
      );
      writeFileSync(
        join(claudeDir, "settings.json"),
        JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
      );
    }
    mkdirSync(join(home, ".local", "state", "cc-smart-dev-kit"), { recursive: true });
    const seen = Date.now() - 5_000;
    writeFileSync(
      join(home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json"),
      JSON.stringify(
        routerState === "breaker"
          ? {
              breakers: {
                [BREAKER_SLOT]: {
                  held: 2,
                  lastAt: seen,
                  since: seen - 20 * 60_000,
                  targets: [
                    {
                      status: 429,
                      target: "omniroute:ollama-cloud/glm-5.3-flash",
                      until: seen + 7 * 60_000,
                    },
                  ],
                },
              },
              fallbacks: {},
              limits: {},
              version: 1,
            }
          : {
              fallbacks: {},
              limits: {
                "claude-opus-5-5": {
                  claim: "five_hour",
                  resetsAt: Math.floor(seen / 1000) + 3600,
                  seenAt: seen,
                },
              },
              version: 1,
            },
      ),
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
    const run = (input: unknown) =>
      Bun.spawnSync([process.execPath, ...guard.args, ENTRY], {
        env: {
          CLAUDE_CONFIG_DIR: claudeDir,
          HOME: home,
          PATH: bin,
          // Claude Code hands a hook the session's effective `ANTHROPIC_BASE_URL` (proved live
          // on 2.1.310): here, the user file's router address above.
          ...(gateway === "none" ? {} : { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" }),
          ...guard.env,
          ...extraEnv,
        },
        stdin: new Blob([typeof input === "string" ? input : JSON.stringify(input)]),
        stderr: "pipe",
        stdout: "pipe",
      });
    return { bin, home, log, run };
  }

  /** A file a detached child writes: waits for it to hold something. */
  async function waitNonEmpty(path: string): Promise<string> {
    for (let tries = 0; tries < 100; tries += 1) {
      if (existsSync(path) && readFileSync(path, "utf8") !== "") return readFileSync(path, "utf8");
      await Bun.sleep(50);
    }
    throw new Error(`${path} stayed empty for 5 s`);
  }

  async function waitFor(path: string): Promise<string> {
    for (let tries = 0; tries < 100; tries += 1) {
      if (existsSync(path) && readFileSync(path, "utf8").includes("---"))
        return readFileSync(path, "utf8");
      await Bun.sleep(50);
    }
    throw new Error(`${path} did not appear within 5 s`);
  }

  it("at the limit: prints nothing, exits 0, and shows the plain alert — no button, no worker, no offer", async () => {
    const m = machine("ok");
    const result = m.run(AT_LIMIT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    const lines = (await waitFor(m.log)).split("\n");
    // The reset time is the machine's clock: only the start and the end are fixed. The call is
    // `notify-send --app-name=… <title> <body>` and nothing else (no `--action`).
    expect(lines.slice(0, 2)).toEqual([
      "--app-name=cc-smart-dev-kit",
      "Claude usage limit reached",
    ]);
    expect(lines[2]).toStartWith("claude-opus-5-5: five_hour, resets ");
    expect(lines[2]).toEndWith("Claude Code continues by itself after the reset.");
    expect(lines[3]).toBe("---");
  });

  it("alerts.sound on: the sound starts beside the alert, from the session's own settings", async () => {
    const m = machine("ok");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(m.home, ".claude"), HOME: m.home });
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(paths.workflowConfigFile, `${JSON.stringify({ alerts: { sound: true } })}\n`);
    const sound = join(m.home, "sound.log");
    writeFileSync(join(m.bin, "paplay"), `#!/bin/sh\necho "$*" >> '${sound}'\n`);
    chmodSync(join(m.bin, "paplay"), 0o755);
    expect(m.run(AT_LIMIT).exitCode).toBe(0);
    expect(await waitNonEmpty(sound)).toBe(
      "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga\n",
    );
    // The alert itself is unchanged by the sound: the same plain notification.
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "--app-name=cc-smart-dev-kit",
      "Claude usage limit reached",
    ]);
  });

  it("alerts.events without `failed`: the limit stop gives no alert at all", async () => {
    const m = machine("ok");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(m.home, ".claude"), HOME: m.home });
    mkdirSync(dirname(paths.workflowConfigFile), { recursive: true });
    writeFileSync(
      paths.workflowConfigFile,
      `${JSON.stringify({ alerts: { events: ["needs-you", "question", "finished"] } })}\n`,
    );
    expect(m.run(AT_LIMIT).exitCode).toBe(0);
    // Nothing may appear. The entry starts its notification detached, so this waits a moment: a
    // check that ran only once would pass whether or not one was on its way.
    for (let tries = 0; tries < 20; tries += 1) {
      expect(existsSync(m.log)).toBe(false);
      await Bun.sleep(50);
    }
  });

  it("a gateway.json that is not JSON: still the plain alert", async () => {
    const m = machine("broken");
    expect(m.run(AT_LIMIT).exitCode).toBe(0);
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "--app-name=cc-smart-dev-kit",
      "Claude usage limit reached",
    ]);
    // The reset time is the machine's clock: only the start and the end are fixed.
    expect(lines[2]).toStartWith("claude-opus-5-5: five_hour, resets ");
    expect(lines[2]).toEndWith("Claude Code continues by itself after the reset.");
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

  it("a background session: no alert and no sound, whatever the limit", async () => {
    // A background session shows no alert of its own: agent view alerts for it while the
    // list is open (`background-session.ts`). The sound is silenced with the alert.
    const m = machine("ok", { CLAUDE_JOB_DIR: join(tempDir("job"), "abc") });
    const result = m.run(AT_LIMIT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
    await Bun.sleep(300);
    expect(existsSync(m.log)).toBe(false);
  });

  it("the breaker's 429: one alert, and the same opening never twice", async () => {
    const m = machine("ok", {}, "breaker");
    const result = m.run(BREAKER);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    const lines = (await waitFor(m.log)).split("\n");
    expect(lines.slice(0, 2)).toEqual(["--app-name=cc-smart-dev-kit", "Gateway slot limited"]);
    // The reset times are the machine's clock: only the start and the end are fixed.
    expect(lines[2]).toStartWith("cc-smart-dev-kit-worker: every target limited or down since ");
    expect(lines[2]).toEndWith("Then send a message to go on.");
    expect(lines[3]).toBe("---");
    // The mark was written: the same opening in a second run shows nothing.
    const shown = readFileSync(m.log, "utf8");
    expect(m.run(BREAKER).exitCode).toBe(0);
    await Bun.sleep(300);
    expect(readFileSync(m.log, "utf8")).toBe(shown);
  });

  it("a breaker stop in a background session: no alert", async () => {
    const m = machine("ok", { CLAUDE_JOB_DIR: join(tempDir("job"), "abc") }, "breaker");
    const result = m.run(BREAKER);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    await Bun.sleep(300);
    expect(existsSync(m.log)).toBe(false);
  });
});
