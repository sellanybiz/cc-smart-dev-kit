/**
 * The opus usage guard (D54): the one reader of Claude Code's 5-hour window, the state file the
 * status line records it in, and the opus slot's fallback chain that lifts the guard.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CliPaths, cliPaths } from "../cli/paths";
import { readUsageWindow, recordUsageWindow, usageWindowFile, windowOf } from "../cli/usage-window";
import { emptyConfig, type GatewayConfig } from "../gateway/config";
import type { MemoryFacts } from "../jobs/memory";
import type { LoadFacts } from "../machine/load";
import { locateCheckout } from "../project/resolve";
import { crewWorld, LEAD_SESSION } from "../testing/crew-world";
import { cleanGitEnv, git, tempDir } from "../testing/temp";
import { capsOf } from "./board";
import { placeForLeadStart } from "./places";
import { writeLead } from "./store";
import { crewSettingsFolder, opusFallbackOf, usageFacts, usageUnreadLine } from "./usage-guard";

/** 2026-10-21 10:00 UTC. */
const NOW = Date.parse("2026-10-21T10:00:00.000Z");
const RESET = NOW / 1000 + 3 * 3600;

/** The status line input as Claude Code passes it, with the 5-hour window `percent` used. */
function inputOf(percent: number, resetsAt: null | number = RESET): Record<string, unknown> {
  return {
    model: { display_name: "Opus 5.5" },
    rate_limits: { five_hour: { resets_at: resetsAt, used_percentage: percent } },
  };
}

/** A temp home with the kit's paths, and that home's state folder made. */
function pathsFor(): CliPaths {
  const paths = cliPaths({ HOME: tempDir("home") });
  mkdirSync(paths.stateDir, { mode: 0o700, recursive: true });
  return paths;
}

describe("the one reader of Claude Code's windows", () => {
  test("the 5-hour window: its share used and when it resets", () => {
    expect(windowOf(inputOf(87.5), "five_hour")).toEqual({ percent: 87.5, resetsAt: RESET });
    expect(windowOf(inputOf(40, null), "five_hour")).toEqual({ percent: 40, resetsAt: null });
  });

  test("no window, or one without a number: null, never an invented number", () => {
    expect(windowOf({ model: {} }, "five_hour")).toBeNull();
    expect(
      windowOf({ rate_limits: { seven_day: { used_percentage: 41 } } }, "five_hour"),
    ).toBeNull();
    expect(windowOf({ rate_limits: { five_hour: { used_percentage: "87" } } }, "five_hour")).toBe(
      null,
    );
    expect(windowOf("not an object", "five_hour")).toBeNull();
    expect(windowOf(null, "five_hour")).toBeNull();
  });
});

describe("the window the status line recorded", () => {
  test("the number and its reset are written; the same numbers again keep the file as it is", () => {
    const paths = pathsFor();
    recordUsageWindow(paths, inputOf(87), NOW);
    const file = usageWindowFile(paths);
    const first = readFileSync(file, "utf8");
    expect(JSON.parse(first)).toEqual({
      fiveHour: { percent: 87, resetsAt: RESET },
      readAt: new Date(NOW).toISOString(),
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    recordUsageWindow(paths, inputOf(87), NOW + 60_000);
    expect(readFileSync(file, "utf8")).toBe(first);
    recordUsageWindow(paths, inputOf(91), NOW + 120_000);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      fiveHour: { percent: 91, resetsAt: RESET },
      readAt: new Date(NOW + 120_000).toISOString(),
    });
  });

  test("a status line input with no window records nothing, so the last one stands", () => {
    const paths = pathsFor();
    recordUsageWindow(paths, inputOf(87), NOW);
    recordUsageWindow(paths, { rate_limits: {} }, NOW + 60_000);
    expect(readUsageWindow(paths, NOW + 60_000)).toEqual({ percent: 87, resetsAt: RESET });
  });

  test("read back: nothing recorded, a broken file, or a window already reset all read as unknown", () => {
    const paths = pathsFor();
    expect(readUsageWindow(paths, NOW)).toBeNull();
    recordUsageWindow(paths, inputOf(87), NOW);
    // The window resets at RESET; past it, that reading measured a window that is over.
    expect(readUsageWindow(paths, NOW)).toEqual({ percent: 87, resetsAt: RESET });
    expect(readUsageWindow(paths, RESET * 1000 + 1)).toBeNull();
    const file = usageWindowFile(paths);
    writeFileSync(file, "not json");
    expect(readUsageWindow(paths, NOW)).toBeNull();
    writeFileSync(file, JSON.stringify({ fiveHour: { percent: 87 } }));
    expect(readUsageWindow(paths, NOW)).toBeNull();
    // A window with no reset time holds while it is younger than the window itself (5 hours),
    // and is unknown after that: it could not describe a window that old.
    writeFileSync(
      file,
      JSON.stringify({
        fiveHour: { percent: 87, resetsAt: null },
        readAt: new Date(NOW - 60 * 60_000).toISOString(),
      }),
    );
    expect(readUsageWindow(paths, NOW)).toEqual({ percent: 87, resetsAt: null });
    writeFileSync(
      file,
      JSON.stringify({
        fiveHour: { percent: 87, resetsAt: null },
        readAt: new Date(NOW - 6 * 60 * 60_000).toISOString(),
      }),
    );
    expect(readUsageWindow(paths, NOW)).toBeNull();
  });
});

describe("D54: the gateway's opus slot lifts the guard", () => {
  const off = emptyConfig();
  const chain: GatewayConfig = {
    ...off,
    backends: { omniroute: { apiKey: "test-key", baseUrl: "http://127.0.0.1:20199" } },
    fallback: { "cc-smart-dev-kit-opus": true },
    slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"] },
  };

  test("a chain in use with its fallback on, and the gateway on: lifted", () => {
    expect(opusFallbackOf({ config: chain, gatewayOn: true })).toBe(true);
  });

  test("no chain, its fallback off, the gateway off, or no config: not lifted", () => {
    expect(opusFallbackOf({ config: { ...chain, slots: {} }, gatewayOn: true })).toBe(false);
    expect(
      opusFallbackOf({
        config: { ...chain, fallback: { "cc-smart-dev-kit-opus": false } },
        gatewayOn: true,
      }),
    ).toBe(false);
    expect(opusFallbackOf({ config: chain, gatewayOn: false })).toBe(false);
    expect(opusFallbackOf({ config: null, gatewayOn: true })).toBe(false);
  });

  test("the facts a start reads: the window from the state file and the chain from the gateway", () => {
    const paths = pathsFor();
    const folder = tempDir("project");
    expect(usageFacts(paths, NOW, folder)).toEqual({ opusFallback: false, percent: null });
    recordUsageWindow(paths, inputOf(87), NOW);
    expect(usageFacts(paths, NOW, folder)).toEqual({ opusFallback: false, percent: 87 });
    mkdirSync(dirname(paths.gatewayConfigFile), { mode: 0o700, recursive: true });
    writeFileSync(paths.gatewayConfigFile, `${JSON.stringify({ ...chain, version: 1 })}\n`, {
      mode: 0o600,
    });
    writeFileSync(
      paths.settingsFile,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20199" } }),
    );
    expect(usageFacts(paths, NOW, folder)).toEqual({ opusFallback: true, percent: 87 });
  });

  describe("RV3: the project's own address decides, not the user's file alone", () => {
    const ROUTER = "http://127.0.0.1:20199";

    /** A machine with the gateway config, the user's file saying `machineUrl`, and a project folder. */
    function world(machineUrl: null | string, config: object = chain) {
      const paths = pathsFor();
      mkdirSync(dirname(paths.gatewayConfigFile), { mode: 0o700, recursive: true });
      writeFileSync(paths.gatewayConfigFile, `${JSON.stringify({ ...config, version: 1 })}\n`, {
        mode: 0o600,
      });
      if (machineUrl !== null) {
        writeFileSync(
          paths.settingsFile,
          JSON.stringify({ env: { ANTHROPIC_BASE_URL: machineUrl } }),
        );
      }
      const folder = tempDir("project");
      /** The project's team file, the one a session started in the folder reads. */
      const projectUrl = (url: string) => {
        mkdirSync(join(folder, ".claude"), { recursive: true });
        writeFileSync(
          join(folder, ".claude", "settings.json"),
          JSON.stringify({ env: { ANTHROPIC_BASE_URL: url } }),
        );
      };
      return { folder, paths, projectUrl };
    }

    test("the machine is off and the project is on: the opus chain answers, the guard is lifted", () => {
      const { folder, paths, projectUrl } = world(null);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(false);
      projectUrl(ROUTER);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(true);
    });

    test("the machine is on and the project is off: Claude answers, the window still holds", () => {
      const { folder, paths, projectUrl } = world(ROUTER);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(true);
      projectUrl("https://api.anthropic.com");
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(false);
    });

    test("a profile's chain decides for a project on its address", () => {
      // The machine's opus slot has no chain; the profile `cheap` has one, with its fallback on.
      const config = {
        ...chain,
        fallback: {},
        port: 20199,
        profiles: {
          cheap: {
            fallback: { "cc-smart-dev-kit-opus": true },
            slots: { "cc-smart-dev-kit-opus": ["omniroute:glm-5.3-flash"] },
          },
        },
        slots: {},
      };
      const { folder, paths, projectUrl } = world(ROUTER, config);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(false);
      projectUrl(`${ROUTER}/p/cheap`);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(true);
      // A profile the config does not hold answers as plain Claude, as the router does.
      projectUrl(`${ROUTER}/p/nope`);
      expect(usageFacts(paths, NOW, folder).opusFallback).toBe(false);
    });
  });

  describe("FX1: one folder for every reader — the lead's own folder, where the crew worktree is cut from", () => {
    const ROUTER = "http://127.0.0.1:20199";

    /**
     * A lead that works in a linked worktree of its repository. The main checkout's team file and
     * the worktree's can differ (a branch that changed `.claude/settings.json`). A crew session's
     * worktree is cut from the lead's branch and Claude Code reads the session's own worktree's
     * team file (proved on 2.1.310, `docs/claude-code-contract.md`), so `crew start`, the guard
     * and the board all read the lead's folder (`crewSettingsFolder`), never the main checkout's.
     * The opus slot has a chain with its fallback on, the 5-hour window is at 90%, and the
     * crew section is on in both folders.
     */
    async function linkedWorld(mainUrl: string, linkedUrl: string) {
      const world = crewWorld();
      const { paths } = world;
      mkdirSync(dirname(paths.gatewayConfigFile), { mode: 0o700, recursive: true });
      writeFileSync(
        paths.gatewayConfigFile,
        `${JSON.stringify({ ...chain, port: 20199, version: 1 })}\n`,
        { mode: 0o600 },
      );
      mkdirSync(paths.stateDir, { mode: 0o700, recursive: true });
      recordUsageWindow(paths, inputOf(90), NOW);
      const linked = join(tempDir("linked"), "side");
      git(world.repo, "worktree", "add", "-q", "-b", "side", linked);
      for (const [folder, url] of [
        [world.repo, mainUrl],
        [linked, linkedUrl],
      ] as const) {
        mkdirSync(join(folder, ".claude"), { recursive: true });
        writeFileSync(
          join(folder, ".claude", "settings.json"),
          JSON.stringify({ env: { ANTHROPIC_BASE_URL: url } }),
        );
        writeFileSync(
          join(folder, ".claude", "cc-smart-dev-kit.json"),
          JSON.stringify({ workflow: { crew: { enabled: true, memoryGb: 1 } } }),
        );
      }
      const checkout = locateCheckout(linked, { env: cleanGitEnv() });
      if (checkout === null) throw new Error("the linked worktree has no checkout");
      expect(checkout.mainCheckout).toBe(world.repo);
      expect(checkout.root).not.toBe(world.repo);
      await writeLead(
        paths.stateDir,
        {
          cwd: linked,
          name: "LEAD my-app plan",
          plan: "plan",
          repo: world.repo,
          sessionId: LEAD_SESSION,
          tag: "my-app",
        },
        NOW,
      );
      return { checkout, paths };
    }

    /** 8 GB free on Linux, as `/proc/meminfo` says it: more than the crew section's `memoryGb`. */
    // A calm machine: the load never holds these starts (LH1); the gateway file is what they test.
    const LOAD: LoadFacts = { cores: () => 8, loadavg: () => [1, 1, 1], platform: "linux" };
    const MEMORY: MemoryFacts = {
      freemem: () => 0,
      platform: "linux",
      read: (path) =>
        path === "/proc/meminfo"
          ? `MemTotal:       33554432 kB\nMemAvailable:   ${8 * 1024 ** 2} kB\n`
          : null,
      totalmem: () => 32 * 1024 ** 3,
    };

    test("the guard asks the lead's own team file, not the main checkout's", async () => {
      // Main off, the worktree on: the opus chain answers, so the window does not hold the start.
      const on = await linkedWorld("https://api.anthropic.com", ROUTER);
      expect(
        await placeForLeadStart({
          checkout: on.checkout,
          leadSessionId: LEAD_SESSION,
          load: LOAD,
          memory: MEMORY,
          nowMs: NOW,
          opus: true,
          paths: on.paths,
        }),
      ).toEqual({ start: true });
      // Main on, the worktree off: Claude answers, so the 90% window holds an opus start.
      const off = await linkedWorld(ROUTER, "https://api.anthropic.com");
      expect(
        await placeForLeadStart({
          checkout: off.checkout,
          leadSessionId: LEAD_SESSION,
          load: LOAD,
          memory: MEMORY,
          nowMs: NOW,
          opus: true,
          paths: off.paths,
        }),
      ).toMatchObject({ start: false });
    });

    test("the board's caps read the same folder", async () => {
      const on = await linkedWorld("https://api.anthropic.com", ROUTER);
      const caps = async (made: typeof on) =>
        await capsOf(
          {
            cwd: made.checkout.root,
            freeMemoryGb: async () => 8,
            load: () => ({ cores: 8, oneMinute: 1 }),
            now: () => NOW,
            paths: made.paths,
          },
          made.checkout,
        );
      expect((await caps(on))?.opusFallback).toBe(true);
      const off = await linkedWorld(ROUTER, "https://api.anthropic.com");
      expect((await caps(off))?.opusFallback).toBe(false);
    });

    test("the one helper names the lead's folder, in a linked worktree and in the main checkout", async () => {
      const made = await linkedWorld(ROUTER, ROUTER);
      expect(crewSettingsFolder(made.checkout)).toBe(made.checkout.root);
      expect(crewSettingsFolder(made.checkout)).not.toBe(made.checkout.mainCheckout);
      const main = locateCheckout(made.checkout.mainCheckout ?? made.checkout.root, {
        env: cleanGitEnv(),
      });
      if (main === null) throw new Error("the main checkout was not found");
      expect(crewSettingsFolder(main)).toBe(main.root);
    });
  });

  test("the one line said when the window cannot be read", () => {
    expect(usageUnreadLine()).toBe(
      "note: the 5-hour usage window cannot be read, so the opus usage guard does not hold: cc-smart-dev-kit setup --statusline records it, and no current reading is stored",
    );
  });
});
