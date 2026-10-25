/**
 * `gateway profile <name> slot|fallback|remove`: a profile's chains and switches in
 * `gateway.json` (D29, GP1's schema and `profileView`), validated the way the machine's
 * `slot` command validates them (each target from the backend's live model list).
 *
 * A temp HOME and config folder throughout; the live model list is a fake fetch, so no test
 * reaches a real backend, and the config's port is a made-up one, never the live router's.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { type GatewayContext, runGateway } from "./commands";
import { PROFILE_HELP } from "./commands-profile";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  fallbackOn,
  type GatewayConfig,
  judgeTestProof,
  loadConfigFile,
  profileView,
  saveConfig,
} from "./config";
import type { HealthFetch } from "./health";

const PORT = 20999;

/**
 * A temp machine whose config holds one profile, and a fake model list for its backend.
 * `profiles: false` leaves the config without a `profiles` key at all (the High the review
 * found: the first chain must make the profile).
 */
function machine(options: { config?: boolean; judgeProof?: boolean; profiles?: boolean } = {}) {
  const home = tempDir("gp2-profile");
  const configDir = join(home, ".claude");
  mkdirSync(configDir, { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  mkdirSync(join(paths.gatewayConfigFile, ".."), { recursive: true });
  if (options.config !== false) {
    saveConfig(paths.gatewayConfigFile, {
      aliases: {},
      anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
      backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
      port: PORT,
      ...(options.profiles === false ? {} : { profiles: { team: {} } }),
      ...(options.judgeProof === true
        ? { judgeTested: { "omniroute:m1": judgeTestProof("omniroute:m1", "http://omni.test") } }
        : {}),
      slots: { "cc-smart-dev-kit-worker": ["omniroute:glm-5.3-flash"] },
      timeouts: { firstByteMs: 1000 },
      version: 1,
    });
  }
  const lines: string[] = [];
  const errors: string[] = [];
  const apiFetch: HealthFetch = async (url) =>
    url.endsWith("/v1/models")
      ? Response.json({ data: [{ id: "glm-5.3-flash" }, { id: "m1" }] })
      : new Response("not found", { status: 404 });
  const ctx: GatewayContext = {
    paths,
    bunPath: process.execPath,
    bunVersion: Bun.version,
    bundle: join(home, "router.js"),
    runner: () => ({ exitCode: 0, output: "" }),
    readStdin: () => Promise.resolve(""),
    confirm: null,
    service: "systemd",
    account: null,
    platform: "linux",
    probe: {
      fetch: async () =>
        Response.json({
          cooling: {},
          fallbacks: 0,
          ok: true,
          port: PORT,
          requests: 0,
          uptimeSec: 1,
        }),
      now: () => 0,
      sleep: () => Promise.resolve(),
    },
    apiFetch,
    print: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  const config = (): GatewayConfig => loadConfigFile(paths.gatewayConfigFile);
  return {
    config,
    configPath: paths.gatewayConfigFile,
    errors,
    home,
    lines,
    output: () => lines.join("\n"),
    paths,
    reset: () => {
      lines.length = 0;
      errors.length = 0;
    },
    run: (args: string[]) => runGateway(args, ctx),
  };
}

describe("gateway profile <name> slot", () => {
  test("the first chain makes the profile, on a config that has no profiles at all", async () => {
    const m = machine({ profiles: false });
    expect(await m.run(["profile", "team", "slot", "worker", "omniroute:m1"])).toBe(0);
    expect(m.config().profiles?.team?.slots?.["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1"]);
  });

  test("off makes a profile too: plain Claude for that slot in it", async () => {
    const m = machine({ profiles: false });
    expect(await m.run(["profile", "fresh", "slot", "worker", "off"])).toBe(0);
    expect(m.config().profiles?.fresh?.slots?.["cc-smart-dev-kit-worker"]).toBe("claude");
  });

  test("after remove, the first chain makes the profile again", async () => {
    const m = machine();
    await m.run(["profile", "team", "remove"]);
    expect(await m.run(["profile", "team", "slot", "worker", "omniroute:m1"])).toBe(0);
    expect(m.config().profiles?.team?.slots?.["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1"]);
  });

  test("clear on a profile that does not name the slot is refused, on a missing one too", async () => {
    const m = machine({ profiles: false });
    await expect(m.run(["profile", "team", "slot", "worker", "clear"])).rejects.toThrow(
      "team does not name cc-smart-dev-kit-worker: the machine's chain already applies there",
    );
  });

  test("sets the profile's own chain, with the machine's chain left alone", async () => {
    const m = machine();
    expect(await m.run(["profile", "team", "slot", "worker", "omniroute:m1"])).toBe(0);
    const config = m.config();
    expect(config.profiles?.team?.slots?.["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1"]);
    expect(config.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:glm-5.3-flash"]);
    expect(m.output()).toContain(
      `~ ${m.configPath.replace(m.home, "~")}: profiles.team.slots["cc-smart-dev-kit-worker"]: (none) -> omniroute:m1`,
    );
    expect(m.output()).toContain(
      "✓ The router uses it from its next request: it reads the config again within about a second.",
    );
  });

  test("a slot's fallback switch of a profile is shown in the profile's view", () => {
    const m = machine();
    const view = profileView(m.config(), "team");
    // The machine's worker chain is what the profile uses until it names one.
    expect(view?.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:glm-5.3-flash"]);
    expect(fallbackOn(view ?? {}, "cc-smart-dev-kit-worker")).toBe(true);
  });

  test("off (or claude) turns that slot off in the profile only, and drops its switches", async () => {
    const m = machine();
    await m.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    await m.run(["profile", "team", "fallback", "worker", "off"]);
    m.reset();

    expect(await m.run(["profile", "team", "slot", "worker", "off"])).toBe(0);
    const config = m.config();
    expect(config.profiles?.team?.slots?.["cc-smart-dev-kit-worker"]).toBe("claude");
    expect(config.profiles?.team?.fallback).toBeUndefined();
    expect(config.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:glm-5.3-flash"]);
    expect(m.output()).toContain(
      "team: cc-smart-dev-kit-worker: Claude (plain Claude in this profile)",
    );
  });

  test("judge off in a profile says who judges there: Claude first, the profile's tested worker targets while it cannot (RV3)", async () => {
    // The router keeps those stand-ins in a profile (`claudeFirstJudge` reads the profile's
    // view), so "plain Claude in this profile" would say more than it does.
    const m = machine({ judgeProof: true });
    await m.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    m.reset();
    expect(await m.run(["profile", "team", "slot", "judge", "off"])).toBe(0);
    expect(m.output()).toContain(
      "team: cc-smart-dev-kit-judge: Claude: Claude first; while Claude is limited or down: omniroute:m1 (fallback on)",
    );
    expect(m.output()).not.toContain("plain Claude in this profile");
    // With the profile's judge fallback off, Claude judges alone, and the words say so.
    const alone = machine({ judgeProof: true });
    await alone.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    await alone.run(["profile", "team", "fallback", "judge", "off"]);
    alone.reset();
    expect(await alone.run(["profile", "team", "slot", "judge", "claude"])).toBe(0);
    expect(alone.output()).toContain(
      "team: cc-smart-dev-kit-judge: Claude: Claude judges every check, alone (fallback off)",
    );
  });

  test("a judge other than Claude is warned about wherever it is set, in a profile too (RV3)", async () => {
    const TRADE_OFF = "a judge other than Claude decides worse";
    // A judge chain of the profile's own.
    const chain = machine({ judgeProof: true });
    expect(await chain.run(["profile", "team", "slot", "judge", "omniroute:m1"])).toBe(0);
    expect(chain.output()).toContain(TRADE_OFF);
    // No chain: the profile's tested worker targets stand in while Claude cannot judge.
    const standIn = machine({ judgeProof: true });
    await standIn.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    standIn.reset();
    expect(await standIn.run(["profile", "team", "slot", "judge", "off"])).toBe(0);
    expect(standIn.output()).toContain(TRADE_OFF);
    // Claude alone judges: nothing to warn about.
    const alone = machine({ judgeProof: true });
    await alone.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    await alone.run(["profile", "team", "fallback", "judge", "off"]);
    alone.reset();
    expect(await alone.run(["profile", "team", "slot", "judge", "off"])).toBe(0);
    expect(alone.output()).not.toContain(TRADE_OFF);
  });

  test("clear takes the entry out: the machine's chain applies there again", async () => {
    const m = machine();
    await m.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    m.reset();
    expect(await m.run(["profile", "team", "slot", "worker", "clear"])).toBe(0);
    expect(m.config().profiles?.team?.slots?.["cc-smart-dev-kit-worker"]).toBeUndefined();
    expect(m.output()).toContain(
      "team: cc-smart-dev-kit-worker: the machine's chain (omniroute:glm-5.3-flash)",
    );
  });

  test("a target the backend does not list is refused, with the command that lists them", async () => {
    const m = machine();
    await expect(m.run(["profile", "team", "slot", "worker", "omniroute:nope"])).rejects.toThrow(
      '"omniroute:nope": "omniroute" has no model "nope" (see cc-smart-dev-kit gateway models)',
    );
  });

  test("a slot name that is not one is refused in the machine command's own words", async () => {
    const m = machine();
    await expect(m.run(["profile", "team", "slot", "Bad Name", "omniroute:m1"])).rejects.toThrow(
      '"Bad Name" is not a slot name (scout, worker, opus, fable, judge, or cc-smart-dev-kit-<name>)',
    );
  });

  test("a custom slot key is a slot like the machine's, as it is there", async () => {
    const m = machine();
    expect(await m.run(["profile", "team", "slot", "affordable", "omniroute:m1"])).toBe(0);
    expect(m.config().profiles?.team?.slots?.["cc-smart-dev-kit-affordable"]).toEqual([
      "omniroute:m1",
    ]);
  });
});

describe("gateway profile <name> fallback", () => {
  test("sets the profile's switch, over the machine's", async () => {
    const m = machine();
    expect(await m.run(["profile", "team", "fallback", "worker", "off"])).toBe(0);
    const config = m.config();
    expect(config.profiles?.team?.fallback?.["cc-smart-dev-kit-worker"]).toBe(false);
    expect(config.fallback).toBeUndefined();
    expect(m.output()).toContain("team: cc-smart-dev-kit-worker: fallback on → off");
  });

  test("the judge's switch, with no judge chain in the profile, says who judges (RV3)", async () => {
    // The judge has no chain of its own here: the switch says whether the profile's tested
    // worker targets stand in while Claude is limited or down, not "the next target answers".
    const m = machine({ judgeProof: true });
    await m.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    m.reset();
    expect(await m.run(["profile", "team", "fallback", "judge", "off"])).toBe(0);
    expect(m.output()).toContain("team: cc-smart-dev-kit-judge: fallback on → off");
    expect(m.output()).toContain("Claude judges every check, alone (fallback off)");
    expect(m.output()).toContain(
      "Only Claude judges; when it is limited or down, its error goes back to Claude Code.",
    );
    expect(m.output()).not.toContain("only the first target answers");
    expect(m.output()).not.toContain("a judge other than Claude decides worse");
    m.reset();
    expect(await m.run(["profile", "team", "fallback", "judge", "on"])).toBe(0);
    expect(m.output()).toContain(
      "Claude first; while Claude is limited or down: omniroute:m1 (fallback on)",
    );
    expect(m.output()).toContain(
      "The worker's tested targets answer when Claude is limited or down.",
    );
    expect(m.output()).not.toContain("the next target answers");
    expect(m.output()).toContain("a judge other than Claude decides worse");
  });

  test("the judge's switch, with a judge chain in the profile, is the chain's switch", async () => {
    const m = machine({ judgeProof: true });
    await m.run(["profile", "team", "slot", "judge", "omniroute:m1"]);
    m.reset();
    expect(await m.run(["profile", "team", "fallback", "judge", "off"])).toBe(0);
    expect(m.output()).toContain(
      "In this profile, only the first target answers; when it fails, its error goes back to Claude Code.",
    );
  });

  test("a value equal to the profile's own default is written as no entry", async () => {
    const m = machine();
    await m.run(["profile", "team", "fallback", "worker", "off"]);
    expect(await m.run(["profile", "team", "fallback", "worker", "on"])).toBe(0);
    expect(m.config().profiles?.team?.fallback).toBeUndefined();
  });

  test("a slot with no chain in the profile is refused, as at the top level", async () => {
    const m = machine();
    await m.run(["profile", "team", "slot", "worker", "off"]);
    m.reset();
    await expect(m.run(["profile", "team", "fallback", "worker", "off"])).rejects.toThrow(
      "profile team has no chain for cc-smart-dev-kit-worker, so there is nothing to fall back to",
    );
  });

  test("on or off is required", async () => {
    const m = machine();
    await expect(m.run(["profile", "team", "fallback", "worker", "yes"])).rejects.toThrow(
      'say on or off, not "yes"',
    );
  });
});

describe("gateway profile <name> breaker (RV3: the switch the docs call the command line's)", () => {
  test("sets the profile's breaker switch over the machine's, which stays on", async () => {
    const m = machine();
    expect(await m.run(["profile", "team", "breaker", "worker", "off"])).toBe(0);
    const config = m.config();
    expect(config.profiles?.team?.breaker?.["cc-smart-dev-kit-worker"]).toBe(false);
    expect(config.breaker).toBeUndefined();
    expect(m.output()).toContain("team: cc-smart-dev-kit-worker: breaker on → off");
    expect(m.output()).toContain(
      "In this profile, when every target is limited or down the last answer goes back at once; the router holds no request.",
    );
  });

  test("a value equal to the default is written as no entry, and 'on' says what the hold does", async () => {
    const m = machine();
    await m.run(["profile", "team", "breaker", "worker", "off"]);
    m.reset();
    expect(await m.run(["profile", "team", "breaker", "worker", "on"])).toBe(0);
    expect(m.config().profiles?.team?.breaker).toBeUndefined();
    expect(m.output()).toContain("team: cc-smart-dev-kit-worker: breaker off → on");
  });

  test("a slot the profile uses from the machine takes a switch too; one with no chain is refused", async () => {
    const m = machine();
    await m.run(["profile", "team", "slot", "worker", "off"]);
    m.reset();
    await expect(m.run(["profile", "team", "breaker", "worker", "off"])).rejects.toThrow(
      "profile team has no chain for cc-smart-dev-kit-worker, so there is no request for the breaker to hold",
    );
  });

  test("the judge never holds, a missing profile and a bad word are refused", async () => {
    const m = machine();
    await expect(m.run(["profile", "team", "breaker", "judge", "off"])).rejects.toThrow(
      "cc-smart-dev-kit-judge: the judge never holds a request",
    );
    await expect(m.run(["profile", "gone", "breaker", "worker", "off"])).rejects.toThrow(
      'gateway.json has no profile "gone"',
    );
    await expect(m.run(["profile", "team", "breaker", "worker", "yes"])).rejects.toThrow(
      'say on or off, not "yes"',
    );
  });

  test("it is in the command's help", () => {
    expect(PROFILE_HELP).toContain("breaker <slot> on|off");
  });
});

describe("a profile's switch on the machine's chain does not block the machine's own change (review: M5)", () => {
  test("slot worker claude drops the profile's fallback switch that had only the machine's chain", async () => {
    const m = machine();
    // The profile names no worker chain: its switch is on the machine's.
    expect(await m.run(["profile", "team", "fallback", "worker", "off"])).toBe(0);
    expect(m.config().profiles?.team?.fallback?.["cc-smart-dev-kit-worker"]).toBe(false);
    m.reset();

    expect(await m.run(["slot", "worker", "claude"])).toBe(0);
    expect(m.config().profiles?.team?.fallback).toBeUndefined();
    expect(m.config().slots["cc-smart-dev-kit-worker"]).toBeUndefined();
    expect(m.output()).toContain(
      "profile team: its fallback and breaker switches for cc-smart-dev-kit-worker went with the chain (the profile has none of its own)",
    );
  });

  test("clear does the same, and a profile with a chain of its own keeps its switch", async () => {
    const m = machine();
    await m.run(["profile", "team", "fallback", "worker", "off"]);
    await m.run(["profile", "keeper", "slot", "worker", "omniroute:m1"]);
    await m.run(["profile", "keeper", "fallback", "worker", "off"]);
    m.reset();

    expect(await m.run(["slot", "worker", "clear"])).toBe(0);
    const config = m.config();
    expect(config.profiles?.team?.fallback).toBeUndefined();
    expect(config.profiles?.keeper?.fallback?.["cc-smart-dev-kit-worker"]).toBe(false);
    expect(m.output()).toContain("profile team:");
    expect(m.output()).not.toContain("profile keeper:");
  });
});

describe("gateway profile <name> remove", () => {
  test("removes the profile and says what a project pointing at it gets", async () => {
    const m = machine();
    await m.run(["profile", "team", "slot", "worker", "omniroute:m1"]);
    m.reset();
    expect(await m.run(["profile", "team", "remove"])).toBe(0);
    expect(m.config().profiles?.team).toBeUndefined();
    expect(m.output()).toContain("A project whose URL still names it answers as plain Claude.");
  });

  test("a profile the config does not have is refused", async () => {
    const m = machine();
    await expect(m.run(["profile", "gone", "remove"])).rejects.toThrow(
      'gateway.json has no profile "gone" (profiles: team)',
    );
  });
});

describe("the profile commands' refusals", () => {
  test("a name a URL could not carry is refused before anything is looked up", async () => {
    const m = machine();
    await expect(m.run(["profile", "Bad_Name", "slot", "worker", "omniroute:m1"])).rejects.toThrow(
      "a profile name is lower-case letters, digits and - (the /p/<name> of a project's URL), at most 64",
    );
  });

  test("a config that is not there is refused, with the command that makes one", async () => {
    const m = machine({ config: false });
    await expect(m.run(["profile", "team", "remove"])).rejects.toThrow(
      `the gateway has no config yet (${m.configPath.replace(m.home, "~")})`,
    );
    expect(existsSync(m.configPath)).toBe(false);
  });

  test("a config that cannot be read is reported, never rewritten", async () => {
    const m = machine();
    writeFileSync(m.configPath, "{not json");
    await expect(m.run(["profile", "team", "slot", "worker", "omniroute:m1"])).rejects.toThrow(
      `${m.configPath} is not valid JSON`,
    );
  });
});
