/**
 * `cc-smart-dev-kit launch`: one Claude Code session with or without the gateway (GP3).
 *
 * A fake `claude` on PATH logs its working folder, every argument, and the text of the file
 * `--settings` names, then exits 7: the tests read that log, the printed line, and the code the
 * command passed on. The gateway config is a temp file of the test's own, on a port no router
 * uses (never 20100), and nothing here reaches the network.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ANTHROPIC_BASE_URL } from "../gateway/config";
import type { HealthFetch } from "../gateway/health";
import { cleanGitEnv, tempDir } from "../testing/temp";
import {
  type LaunchContext,
  launchSettingsFile,
  parseLaunchArgs,
  realRunSession,
  runLaunch,
} from "./launch";

/** A port no router uses: the config only names it, nothing connects. */
const TEST_PORT = 45_321;
const ROUTER_URL = `http://127.0.0.1:${TEST_PORT}`;

/** The file this process's launch passes: the name carries the pid (two launches never clash). */
function settingsFileOf(world: World, key: string): string {
  return join(world.stateDir, "launch", `${key}-${process.pid}.json`);
}

interface World {
  bin: string;
  claude: string;
  configPath: string;
  cwd: string;
  env: Record<string, string>;
  home: string;
  log: string;
  stateDir: string;
}

/** A temp home, a fake `claude` that logs (its arguments, and the settings it read), exits 7. */
function world(): World {
  const home = tempDir("launch");
  const stateDir = join(home, ".claude", "cc-smart-dev-kit");
  const configPath = join(home, ".config", "cc-smart-dev-kit", "gateway.json");
  const cwd = tempDir("launch-cwd");
  const bin = join(home, "bin");
  const log = join(home, "claude.log");
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, "claude");
  writeFileSync(
    claude,
    `#!/bin/sh
{
  echo "cwd=$(pwd)"
  previous=""
  for arg in "$@"; do
    echo "arg=$arg"
    if [ "$previous" = "--settings" ]; then
      echo "settings:"
      cat "$arg"
    fi
    previous="$arg"
  done
} >> "$FAKE_CLAUDE_LOG"
exit 7
`,
  );
  chmodSync(claude, 0o755);
  return {
    bin,
    claude,
    configPath,
    cwd,
    env: { ...cleanGitEnv(), FAKE_CLAUDE_LOG: log },
    home,
    log,
    stateDir,
  };
}

/** A gateway config the reader accepts, mode 600, with the profiles given. */
function gatewayConfig(world: World, profiles: string[]): void {
  mkdirSync(join(world.home, ".config", "cc-smart-dev-kit"), { recursive: true });
  const body = {
    backends: {},
    port: TEST_PORT,
    profiles: Object.fromEntries(profiles.map((name) => [name, { slots: {} }])),
    slots: {},
    timeouts: { firstByteMs: 60_000 },
    version: 1,
  };
  writeFileSync(world.configPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

/** A router's health answer: this version's lists `profiles`; a 1.1.x copy's has no `features`. */
function healthOf(router: "current" | "old"): HealthFetch {
  return async () =>
    Response.json({
      ...(router === "current" ? { features: ["profiles"] } : {}),
      ok: true,
      port: TEST_PORT,
    });
}

/** The command's context, with its output recorded and its session run faked by default. */
function context(
  world: World,
  overrides: Partial<LaunchContext> = {},
): LaunchContext & { errors: string[]; printed: string[] } {
  const errors: string[] = [];
  const printed: string[] = [];
  return {
    configPath: world.configPath,
    cwd: world.cwd,
    env: world.env,
    error: (line) => errors.push(line),
    errors,
    fetch: healthOf("current"),
    home: world.home,
    platform: "linux",
    print: (line) => printed.push(line),
    printed,
    runSession: realRunSession,
    stateDir: world.stateDir,
    which: (command) => (command === "claude" ? world.claude : null),
    ...overrides,
  };
}

/** Every line the fake `claude` wrote. */
function runLog(world: World): string[] {
  return existsSync(world.log) ? readFileSync(world.log, "utf8").trimEnd().split("\n") : [];
}

/** The settings file's text the fake `claude` read, as it read it. */
function loggedSettings(world: World): string {
  const lines = runLog(world);
  const at = lines.indexOf("settings:");
  if (at === -1) return "";
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("arg=")) break;
    body.push(line);
  }
  return `${body.join("\n")}\n`;
}

describe("the arguments", () => {
  test("nothing: this machine's own settings decide, and every Claude argument passes on", () => {
    expect(parseLaunchArgs([])).toEqual({ claudeArgs: [], mode: { kind: "default" } });
    expect(parseLaunchArgs(["--", "--model", "haiku", "-p", "hello"])).toEqual({
      claudeArgs: ["--model", "haiku", "-p", "hello"],
      mode: { kind: "default" },
    });
  });

  test("the three modes, each with Claude's own arguments after --", () => {
    expect(parseLaunchArgs(["--no-gateway", "--", "-p", "hi"])).toEqual({
      claudeArgs: ["-p", "hi"],
      mode: { kind: "no-gateway" },
    });
    expect(parseLaunchArgs(["--gateway"])).toEqual({
      claudeArgs: [],
      mode: { kind: "gateway" },
    });
    expect(parseLaunchArgs(["--profile", "fast", "--", "--resume"])).toEqual({
      claudeArgs: ["--resume"],
      mode: { kind: "profile", name: "fast" },
    });
  });

  test("two modes at once, a missing name, or an option without -- is a usage error", () => {
    for (const args of [
      ["--gateway", "--no-gateway"],
      ["--gateway", "--profile", "fast"],
      ["--profile"],
      ["--profile", "--gateway"],
      ["--model", "haiku"],
      ["--no-gateway", "extra"],
    ]) {
      expect(parseLaunchArgs(args)).toHaveProperty("error");
    }
  });

  test("-- --help belongs to Claude Code, and a lone -- passes nothing", () => {
    expect(parseLaunchArgs(["--", "--help"])).toEqual({
      claudeArgs: ["--help"],
      mode: { kind: "default" },
    });
    expect(parseLaunchArgs(["--"])).toEqual({ claudeArgs: [], mode: { kind: "default" } });
  });
});

describe("launch", () => {
  test("--no-gateway writes one settings file, runs claude attached with it, and passes its code on", async () => {
    const home = world();
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway", "--", "--model", "haiku"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([]);

    const settingsFile = settingsFileOf(home, "no-gateway");
    expect(runLog(home)).toEqual([
      `cwd=${home.cwd}`,
      "arg=--settings",
      `arg=${settingsFile}`,
      "settings:",
      "{",
      '  "env": {',
      `    "ANTHROPIC_BASE_URL": "${DEFAULT_ANTHROPIC_BASE_URL}"`,
      "  }",
      "}",
      "arg=--model",
      "arg=haiku",
    ]);
    expect(ctx.printed).toEqual([
      `launch: plain Claude (no gateway) · ${DEFAULT_ANTHROPIC_BASE_URL}`,
    ]);
    // Its file goes when the session ends: no stale file a later launch could read.
    expect(existsSync(settingsFile)).toBe(false);
  });

  test("the file is mode 0600 while the session runs, and it holds only the base URL", async () => {
    const home = world();
    const seen: { mode: number; text: string }[] = [];
    const ctx = context(home, {
      runSession: async () => {
        const file = settingsFileOf(home, "no-gateway");
        seen.push({ mode: statSync(file).mode & 0o777, text: readFileSync(file, "utf8") });
        return 7;
      },
    });
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(seen).toEqual([
      {
        mode: 0o600,
        text: `{\n  "env": {\n    "ANTHROPIC_BASE_URL": "${DEFAULT_ANTHROPIC_BASE_URL}"\n  }\n}\n`,
      },
    ]);
  });

  test("--gateway uses the config's own port; no settings file is written without a mode", async () => {
    const home = world();
    gatewayConfig(home, []);
    const ctx = context(home);
    expect(await runLaunch(["--gateway", "--", "-p", "hi"], ctx)).toBe(7);
    expect(loggedSettings(home)).toBe(
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: ROUTER_URL } }, null, 2)}\n`,
    );
    expect(runLog(home)).toContain(`arg=${settingsFileOf(home, "gateway")}`);
    expect(ctx.printed).toEqual([`launch: the gateway · ${ROUTER_URL}`]);

    const plain = world();
    const plainCtx = context(plain);
    expect(await runLaunch(["--", "-p", "hi"], plainCtx)).toBe(7);
    expect(existsSync(join(plain.stateDir, "launch"))).toBe(false);
    expect(runLog(plain)).toEqual([`cwd=${plain.cwd}`, "arg=-p", "arg=hi"]);
    expect(plainCtx.printed).toEqual(["launch: this machine's settings · no --settings file"]);
  });

  test("--profile writes the profile's URL", async () => {
    const home = world();
    gatewayConfig(home, ["fast", "slow"]);
    const ctx = context(home);
    expect(await runLaunch(["--profile", "fast"], ctx)).toBe(7);
    expect(loggedSettings(home)).toBe(
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: `${ROUTER_URL}/p/fast` } }, null, 2)}\n`,
    );
    expect(ctx.printed[0]).toBe(`launch: the gateway, profile "fast" · ${ROUTER_URL}/p/fast`);
  });

  test("--profile on an older router (no profiles in its features) runs nothing, and names gateway setup", async () => {
    const home = world();
    gatewayConfig(home, ["fast"]);
    const asked: string[] = [];
    const old = healthOf("old");
    const ctx = context(home, {
      fetch: (url, init) => {
        asked.push(url);
        return old(url, init);
      },
    });
    expect(await runLaunch(["--profile", "fast"], ctx)).toBe(1);
    expect(asked).toEqual([`${ROUTER_URL}/__cc-smart-dev-kit/health`]);
    expect(ctx.errors).toEqual([
      `launch: the router running on 127.0.0.1:${TEST_PORT} is an older copy that does not know profiles, so every request through a profile's address would fail.`,
      "Fix: cc-smart-dev-kit gateway setup puts this version's router in place.",
    ]);
    expect(runLog(home)).toEqual([]);
    expect(existsSync(join(home.stateDir, "launch"))).toBe(false);
  });

  test("--profile on a router that does not answer runs nothing either", async () => {
    const home = world();
    gatewayConfig(home, ["fast"]);
    const ctx = context(home, {
      fetch: async () => {
        throw new TypeError("Unable to connect");
      },
    });
    expect(await runLaunch(["--profile", "fast"], ctx)).toBe(1);
    expect(ctx.errors).toEqual([
      `launch: the router does not answer on 127.0.0.1:${TEST_PORT} (Unable to connect), so it cannot say it knows profiles.`,
      "Fix: cc-smart-dev-kit gateway setup",
    ]);
    expect(runLog(home)).toEqual([]);
  });

  test("--gateway asks no router: a plain gateway URL needs no feature", async () => {
    const home = world();
    gatewayConfig(home, []);
    const ctx = context(home, {
      fetch: async () => {
        throw new Error("launch --gateway must not ask the router");
      },
    });
    expect(await runLaunch(["--gateway"], ctx)).toBe(7);
  });

  test("the settings file's name carries the process and the mode: two launches never clash", () => {
    expect(launchSettingsFile("/state", { kind: "no-gateway" }, 111)).toBe(
      "/state/launch/no-gateway-111.json",
    );
    expect(launchSettingsFile("/state", { kind: "no-gateway" }, 222)).toBe(
      "/state/launch/no-gateway-222.json",
    );
    expect(launchSettingsFile("/state", { kind: "profile", name: "fast" }, 111)).toBe(
      "/state/launch/profile-fast-111.json",
    );
    expect(launchSettingsFile("/state", { kind: "default" }, 111)).toBeNull();
    // A name no URL can carry never becomes a file name, however it got here.
    expect(launchSettingsFile("/state", { kind: "profile", name: "../../escape" }, 111)).toBeNull();
  });

  test("--gateway with no gateway on the machine says so, and runs nothing", async () => {
    const home = world();
    const ctx = context(home);
    expect(await runLaunch(["--gateway"], ctx)).toBe(1);
    expect(ctx.errors).toEqual([
      "launch --gateway needs the gateway set up, and this machine has no gateway config yet.",
      "Fix: cc-smart-dev-kit gateway setup",
    ]);
    expect(runLog(home)).toEqual([]);
  });

  test("a config it cannot read is one line and a fix, never the reader's schema tree", async () => {
    const home = world();
    mkdirSync(join(home.home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(home.configPath, `{"port": "not a port", "version": 1}\n`, { mode: 0o600 });
    const ctx = context(home);
    expect(await runLaunch(["--gateway"], ctx)).toBe(1);
    expect(ctx.errors).toEqual([
      `launch: the gateway's config cannot be read: ${home.configPath} is not a valid gateway config:`,
      "Fix: fix ~/.config/cc-smart-dev-kit/gateway.json by hand, then run cc-smart-dev-kit gateway status to check it.",
    ]);
    expect(runLog(home)).toEqual([]);
  });

  test("a profile the config does not have is refused with the ones it has", async () => {
    const home = world();
    gatewayConfig(home, ["fast", "slow"]);
    const ctx = context(home);
    expect(await runLaunch(["--profile", "nope"], ctx)).toBe(1);
    expect(ctx.errors[0]).toBe('launch: the gateway has no profile "nope". It has: fast, slow.');
    expect(ctx.errors[1]).toContain("cc-smart-dev-kit gateway profile");
    expect(runLog(home)).toEqual([]);
  });

  test("a name no URL can carry is refused by the one rule that says why", async () => {
    const home = world();
    gatewayConfig(home, ["fast"]);
    const ctx = context(home);
    expect(await runLaunch(["--profile", "Fast One"], ctx)).toBe(1);
    expect(ctx.errors[0]).toStartWith("launch: a profile name is ");
    expect(runLog(home)).toEqual([]);
  });

  test("inside a Claude Code session it runs nothing: that would be a session inside a session", async () => {
    const home = world();
    const ctx = context(home, { env: { ...home.env, CLAUDECODE: "1" } });
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(1);
    expect(ctx.errors).toEqual([
      "launch starts a new Claude Code session, and this is already one: run it from your own terminal.",
    ]);
    expect(runLog(home)).toEqual([]);
  });

  test("a session that will not start leaves no settings file behind", async () => {
    const home = world();
    const ctx = context(home, {
      runSession: async () => {
        throw new Error("the spawner refused");
      },
    });
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(1);
    expect(ctx.errors[0]).toBe("launch: claude did not start: the spawner refused");
    expect(existsSync(settingsFileOf(home, "no-gateway"))).toBe(false);
  });

  test("no claude on the machine: one line, exit 1", async () => {
    const home = world();
    const ctx = context(home, { which: () => null });
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(1);
    expect(ctx.errors[0]).toStartWith("launch: claude was not found on PATH");
    expect(ctx.printed).toEqual([]);
  });

  test("a wrong option exits 2, says where Claude's own options go, and names --help", async () => {
    const home = world();
    const ctx = context(home);
    expect(await runLaunch(["--model", "haiku"], ctx)).toBe(2);
    expect(ctx.errors[0]).toBe(
      "Unknown option: --model. Claude Code's own options go after --, for example: cc-smart-dev-kit launch --gateway -- --model\nSee: cc-smart-dev-kit launch --help",
    );
    expect(runLog(home)).toEqual([]);
  });

  test("Windows: a claude.cmd runs through cmd.exe, one quoted line, the settings path in it", async () => {
    const home = world();
    const seen: { argv: string[]; verbatim: boolean }[] = [];
    const ctx = context(home, {
      platform: "win32",
      runSession: async (argv, options) => {
        seen.push({ argv, verbatim: options.verbatim });
        return 0;
      },
      which: () => "C:\\Users\\someone\\claude.cmd",
    });
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(0);
    expect(seen).toHaveLength(1);
    const { argv, verbatim } = seen[0] ?? { argv: [], verbatim: false };
    expect(verbatim).toBe(true);
    expect(argv.slice(0, 5)).toEqual(["cmd", "/d", "/s", "/v:off", "/c"]);
    expect(argv[5]).toContain("claude.cmd");
    expect(argv[5]).toContain("--settings");
    expect(argv[5]).toContain(`no-gateway-${process.pid}.json`);
  });
});
