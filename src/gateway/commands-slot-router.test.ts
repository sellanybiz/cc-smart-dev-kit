/**
 * `gateway slot` and a router that is older than the CLI (RV3, finding 2 of the 1.2.0 split review).
 *
 * 1.2.0 lets an alias point at a slot in Claude mode (a slot not in `slots`): `migrate` writes
 * aliases like that, and `slot <slot> claude` would be refused without it. The router that is
 * still running after the background update may be 1.1.x, whose schema refuses such a file: it
 * logs an error, keeps its last good config, and ignores every later change. The router carries
 * no version, so the CLI asks its health page for the feature (`claude-slot-aliases`) before it
 * saves a config that needs it.
 *
 * A temp HOME and a made-up port throughout; the router is a fake health answer, never a real
 * port (never 20100).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { type GatewayContext, runGateway } from "./commands";
import { emptyConfig, loadConfigFile, saveConfig } from "./config";

const PORT = 20998;
const WORKER = "cc-smart-dev-kit-worker";
const SCOUT = "cc-smart-dev-kit-scout";

type Router = "current" | "old" | "silent";

/**
 * A machine that came from the anymodel names: `migrate` wrote `anymodel-worker` as an alias of
 * the worker slot. `router` is what answers the health page: this version's lists the feature, a
 * 1.1.x copy's has no `features`, and `silent` is a connection that is refused.
 */
function machine(router: Router, options: { aliased?: boolean; workerIsClaude?: boolean } = {}) {
  const home = tempDir("slot-router");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  mkdirSync(dirname(paths.gatewayConfigFile), { recursive: true });
  saveConfig(paths.gatewayConfigFile, {
    ...emptyConfig(),
    aliases: options.aliased === false ? {} : { "anymodel-worker": WORKER },
    backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
    port: PORT,
    ...(options.workerIsClaude === true
      ? {
          kept: { [WORKER]: { targets: ["omniroute:glm-5.3-flash"] } },
          slots: { [SCOUT]: ["omniroute:glm-5.3-flash"] },
        }
      : { slots: { [WORKER]: ["omniroute:glm-5.3-flash"], [SCOUT]: ["omniroute:glm-5.3-flash"] } }),
  });
  const asked: string[] = [];
  const lines: string[] = [];
  const errors: string[] = [];
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
      fetch: async (url) => {
        asked.push(url);
        if (router === "silent") throw new TypeError("Unable to connect");
        return Response.json({
          ...(router === "current" ? { features: ["profiles", "claude-slot-aliases"] } : {}),
          ok: true,
          port: PORT,
        });
      },
      now: () => 0,
      sleep: () => Promise.resolve(),
    },
    apiFetch: async () => new Response("not found", { status: 404 }),
    print: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  return {
    paths,
    asked,
    config: () => loadConfigFile(paths.gatewayConfigFile),
    file: () => readFileSync(paths.gatewayConfigFile, "utf8"),
    output: () => lines.join("\n"),
    run: (args: string[]) => runGateway(args, ctx),
  };
}

describe("a slot change that leaves an alias at a slot in Claude mode", () => {
  test.each(["claude", "off", "clear"])(
    "slot worker %s on a 1.1.x router is refused before anything is written, and names gateway setup",
    async (word) => {
      const m = machine("old");
      const before = m.file();
      await expect(m.run(["slot", "worker", word])).rejects.toThrow(
        `the router running on 127.0.0.1:${PORT} is an older copy that refuses an alias to a slot that is Claude (alias "anymodel-worker" → ${WORKER}), so it would keep its old config and ignore this change. Run cc-smart-dev-kit gateway setup first: it puts this version's router in place.`,
      );
      expect(m.file()).toBe(before);
      expect(m.asked).toEqual([`http://127.0.0.1:${PORT}/__cc-smart-dev-kit/health`]);
    },
  );

  test("the router that lists the feature takes the change, and the alias stays", async () => {
    const m = machine("current");
    expect(await m.run(["slot", "worker", "claude"])).toBe(0);
    expect(m.config().slots[WORKER]).toBeUndefined();
    expect(m.config().aliases).toEqual({ "anymodel-worker": WORKER });
    expect(m.output()).toContain("The router uses it from its next request.");
  });

  test("a router that does not answer cannot say: the change is saved, with a warning that names setup", async () => {
    const m = machine("silent");
    expect(await m.run(["slot", "worker", "claude"])).toBe(0);
    expect(m.config().slots[WORKER]).toBeUndefined();
    expect(m.output()).toContain(
      `! the router does not answer on 127.0.0.1:${PORT} (Unable to connect), so it cannot say it reads an alias to a slot that is Claude (alias "anymodel-worker" → ${WORKER}); if an older copy starts, it will ignore this file. Run cc-smart-dev-kit gateway setup so the copy that runs is this version's.`,
    );
    expect(m.output()).not.toContain("The router uses it from its next request.");
  });

  test("a change to another slot is refused too while the file already holds such an alias", async () => {
    // The worker is already Claude and the alias already points at it: the old router has been
    // ignoring this file since that save, so a further change would be ignored as well.
    const m = machine("old", { workerIsClaude: true });
    const before = m.file();
    await expect(m.run(["slot", "scout", "claude"])).rejects.toThrow("older copy");
    expect(m.file()).toBe(before);
  });
});

describe("a slot change with no alias at a slot in Claude mode asks no router", () => {
  test.each([
    ["no alias at all", { aliased: false }, ["slot", "worker", "claude"]],
    ["an alias at a slot that stays in use", {}, ["slot", "scout", "claude"]],
  ] as const)("%s", async (_name, options, args) => {
    const m = machine("old", options);
    expect(await m.run([...args])).toBe(0);
    expect(m.asked).toEqual([]);
    expect(m.output()).not.toContain("does not answer");
  });
});

test("slot changes refresh the active owned menu", async () => {
  const m = machine("current");
  expect(await m.run(["on"])).toBe(0);
  let settings = JSON.parse(readFileSync(m.paths.settingsFile, "utf8"));
  expect(settings.modelPicker.options[1]).toEqual({
    model: "sonnet",
    label: "Sonnet",
    description: "answered by glm-5.3-flash (worker slot)",
  });
  expect(await m.run(["slot", "worker", "claude"])).toBe(0);
  settings = JSON.parse(readFileSync(m.paths.settingsFile, "utf8"));
  expect(settings.modelPicker.options[1]).toEqual({
    model: "sonnet",
    label: "Sonnet",
    description: "Claude's newest Sonnet",
  });
});
