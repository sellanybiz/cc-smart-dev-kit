/**
 * `cc-smart-dev-kit launch`: one Claude Code session with or without the gateway (GP3).
 *
 * A fake `claude` on PATH logs its working folder, every argument, and the text of the file
 * `--settings` names, then exits 7: the tests read that log, the printed line, and the code the
 * command passed on. The gateway config is a temp file of the test's own, on a port no router
 * uses (never 20100), and nothing here reaches the network.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_ANTHROPIC_BASE_URL } from "../gateway/config";
import type { HealthFetch } from "../gateway/health";
import { applyManagedJson } from "../setup/managed-json";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";
import {
  type LaunchContext,
  launcherSignals,
  launchSettingsFile,
  parseLaunchArgs,
  realRunSession,
  runLaunch,
  type SignalPlan,
} from "./launch";

const expectedPicker = {
  replaceBuiltInOptions: true,
  options: [
    { model: "opus", label: "Opus", description: "Claude's newest Opus" },
    { model: "sonnet", label: "Sonnet", description: "Claude's newest Sonnet" },
    { model: "haiku", label: "Haiku", description: "Claude's newest Haiku" },
    { model: "fable", label: "Fable", description: "Claude's newest Fable" },
  ],
};

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
  applyManagedJson({
    file: join(world.home, ".claude", "settings.json"),
    stateDir: world.stateDir,
    set: [[["modelPicker"], expectedPicker]],
  });
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
    settingsFile: join(world.home, ".claude", "settings.json"),
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
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: ROUTER_URL }, modelPicker: expectedPicker }, null, 2)}\n`,
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
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: `${ROUTER_URL}/p/fast` }, modelPicker: expectedPicker }, null, 2)}\n`,
    );
    expect(ctx.printed[0]).toBe(`launch: the gateway, profile "fast" · ${ROUTER_URL}/p/fast`);
  });

  test("--profile carries backend rows instead of the machine's rows", async () => {
    const home = world();
    gatewayConfig(home, ["fast"]);
    const config = JSON.parse(readFileSync(home.configPath, "utf8"));
    config.backends = { omniroute: { baseUrl: "http://omni.test", apiKey: "test-key" } };
    config.profiles.fast.slots = { "cc-smart-dev-kit-opus": ["omniroute:codex/gpt-6.1-sol"] };
    writeFileSync(home.configPath, JSON.stringify(config), { mode: 0o600 });
    expect(await runLaunch(["--profile", "fast"], context(home))).toBe(7);
    expect(JSON.parse(loggedSettings(home)).modelPicker.options[0]).toEqual({
      model: "opus",
      label: "Opus",
      description: "answered by gpt-6.1-sol (opus slot)",
    });
  });

  test("no-gateway overrides only our menu with plain Claude rows", async () => {
    const home = world();
    gatewayConfig(home, []);
    const config = JSON.parse(readFileSync(home.configPath, "utf8"));
    config.backends = { omniroute: { baseUrl: "http://omni.test", apiKey: "test-key" } };
    config.slots = { "cc-smart-dev-kit-opus": ["omniroute:codex/gpt-6.1-sol"] };
    writeFileSync(home.configPath, JSON.stringify(config), { mode: 0o600 });
    applyManagedJson({
      file: join(home.home, ".claude", "settings.json"),
      stateDir: home.stateDir,
      set: [
        [
          ["modelPicker"],
          { options: [{ model: "opus", description: "answered by gpt-6.1-sol (opus slot)" }] },
        ],
      ],
    });
    expect(await runLaunch(["--no-gateway"], context(home))).toBe(7);
    expect(JSON.parse(loggedSettings(home)).modelPicker).toEqual(expectedPicker);
  });
  for (const mode of [["--gateway"], ["--profile", "fast"], ["--no-gateway"]]) {
    test(`launch ${mode.join(" ")} does not replace a personal menu`, async () => {
      const home = world();
      gatewayConfig(home, ["fast"]);
      writeFileSync(
        join(home.home, ".claude", "settings.json"),
        JSON.stringify({ modelPicker: { options: [] } }),
      );
      expect(await runLaunch(mode, context(home))).toBe(7);
      expect(JSON.parse(loggedSettings(home)).modelPicker).toBeUndefined();
    });
  }

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

  test("--gateway asks the router's health page once, and needs no feature from it", async () => {
    const home = world();
    gatewayConfig(home, []);
    const asked: string[] = [];
    // A 1.1.x router lists no features: a plain gateway URL works there, so it still launches.
    const old = healthOf("old");
    const ctx = context(home, {
      fetch: (url, init) => {
        asked.push(url);
        return old(url, init);
      },
    });
    expect(await runLaunch(["--gateway"], ctx)).toBe(7);
    expect(asked).toEqual([`${ROUTER_URL}/__cc-smart-dev-kit/health`]);
    expect(ctx.printed).toEqual([`launch: the gateway · ${ROUTER_URL}`]);
  });

  test("--gateway on a router that does not answer runs nothing, and names gateway setup", async () => {
    // The config is there but nothing listens: after a full `restore` (it keeps gateway.json),
    // or a stopped service. A session would retry its connection for minutes, saying nothing.
    const home = world();
    gatewayConfig(home, []);
    const ctx = context(home, {
      fetch: async () => {
        throw new TypeError("Unable to connect");
      },
    });
    expect(await runLaunch(["--gateway"], ctx)).toBe(1);
    expect(ctx.errors).toEqual([
      `launch: the router does not answer on 127.0.0.1:${TEST_PORT} (Unable to connect), so every request of the session would fail.`,
      "Fix: cc-smart-dev-kit gateway setup",
    ]);
    expect(ctx.printed).toEqual([]);
    expect(runLog(home)).toEqual([]);
    expect(existsSync(join(home.stateDir, "launch"))).toBe(false);
  });

  test("--gateway on a router that answers an error page is refused the same way", async () => {
    const home = world();
    gatewayConfig(home, []);
    const ctx = context(home, { fetch: async () => new Response("down", { status: 503 }) });
    expect(await runLaunch(["--gateway"], ctx)).toBe(1);
    expect(ctx.errors[0]).toBe(
      `launch: the router does not answer on 127.0.0.1:${TEST_PORT} (HTTP 503), so every request of the session would fail.`,
    );
    expect(runLog(home)).toEqual([]);
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

describe("RV3: the launcher hands a signal sent to it on to the session it runs", () => {
  /**
   * Runs `realRunSession` in a bun process of its own around a fake `claude` that says "ready",
   * then ends with its own code for the signal it gets (TERM 7, HUP 8, INT 9), and writes the
   * signal it got to a file. Sends `signal` to the launcher alone, as `kill <pid>` does; with
   * `consoleToo`, it then sends the same signal to the session, as a Windows console does with
   * a Ctrl+C (every process on it gets the event). `platform` is what the launcher is told it
   * runs on.
   */
  async function signalLauncher(
    signal: "SIGHUP" | "SIGINT" | "SIGTERM",
    platform: NodeJS.Platform = process.platform,
    consoleToo = false,
  ): Promise<{ code: null | number; got: string }> {
    const dir = tempDir("launch-signal");
    const got = join(dir, "got.txt");
    const pidFile = join(dir, "claude.pid");
    const claude = join(dir, "claude");
    writeFileSync(
      claude,
      [
        "#!/bin/sh",
        `echo $$ > "${pidFile}"`,
        `trap 'echo TERM > "${got}"; exit 7' TERM`,
        `trap 'echo HUP > "${got}"; exit 8' HUP`,
        `trap 'echo INT > "${got}"; exit 9' INT`,
        "echo ready",
        "while true; do sleep 0.05; done",
      ].join("\n"),
    );
    chmodSync(claude, 0o755);
    const runner = join(dir, "runner.ts");
    writeFileSync(
      runner,
      [
        `import { realRunSession } from ${JSON.stringify(join(import.meta.dir, "launch"))};`,
        `process.exitCode = await realRunSession([${JSON.stringify(claude)}], { cwd: ${JSON.stringify(dir)}, env: process.env, platform: ${JSON.stringify(platform)}, verbatim: false });`,
      ].join("\n"),
    );
    const guard = subprocessGuard();
    const launcher = Bun.spawn([process.execPath, ...guard.args, runner], {
      env: { ...process.env, ...guard.env },
      stderr: "pipe",
      stdout: "pipe",
    });
    try {
      // The session is up when it has said so: no guessing at a delay.
      const reader = launcher.stdout.getReader();
      let said = "";
      while (!said.includes("ready")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        said += new TextDecoder().decode(chunk.value);
      }
      expect(said).toContain("ready");
      launcher.kill(signal);
      if (consoleToo) process.kill(Number(readFileSync(pidFile, "utf8").trim()), signal);
      const code = await launcher.exited;
      return { code, got: existsSync(got) ? readFileSync(got, "utf8").trim() : "" };
    } finally {
      // A session the launcher left behind must not outlive the test.
      launcher.kill("SIGKILL");
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGKILL");
        } catch {
          // Already gone: the launcher stopped it.
        }
      }
    }
  }

  test("a session ended by a signal gives the shell's code for it, 128 plus the number", async () => {
    const dir = tempDir("launch-killed");
    const claude = join(dir, "claude");
    writeFileSync(claude, ["#!/bin/sh", "kill -KILL $$"].join("\n"));
    chmodSync(claude, 0o755);
    const runner = join(dir, "runner.ts");
    writeFileSync(
      runner,
      [
        `import { realRunSession } from ${JSON.stringify(join(import.meta.dir, "launch"))};`,
        `process.exitCode = await realRunSession([${JSON.stringify(claude)}], { cwd: ${JSON.stringify(dir)}, env: process.env, platform: ${JSON.stringify(process.platform)}, verbatim: false });`,
      ].join("\n"),
    );
    const guard = subprocessGuard();
    const launcher = Bun.spawn([process.execPath, ...guard.args, runner], {
      env: { ...process.env, ...guard.env },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(await launcher.exited).toBe(137);
  });

  test("on Windows a console signal does not end the launcher before the session: it waits and returns the session's code", async () => {
    // The console gives a Ctrl+C to every process on it: the launcher and the session each get
    // the signal by themselves, and the launcher forwards nothing. With no listener Bun's default
    // action would end the launcher at once, skipping its cleanup and the session's exit code.
    expect(await signalLauncher("SIGINT", "win32", true)).toEqual({ code: 9, got: "INT" });
    expect(await signalLauncher("SIGHUP", "win32", true)).toEqual({ code: 8, got: "HUP" });
  });

  test("the signals the launcher listens for: handed on off Windows; on Windows taken, handed on to no one", () => {
    const handedOn: SignalPlan[] = [
      { forward: true, signal: "SIGHUP" },
      { forward: true, signal: "SIGINT" },
      { forward: true, signal: "SIGTERM" },
    ];
    expect(launcherSignals("linux")).toEqual(handedOn);
    expect(launcherSignals("darwin")).toEqual(handedOn);
    // The console gives a Ctrl+C, a Ctrl+Break and a close to the session itself, and kill ends
    // a process outright there: nothing is forwarded, but the launcher still listens.
    expect(launcherSignals("win32")).toEqual([
      { forward: false, signal: "SIGHUP" },
      { forward: false, signal: "SIGINT" },
      { forward: false, signal: "SIGBREAK" },
    ]);
  });

  test.each([
    ["SIGTERM", "TERM", 7],
    ["SIGHUP", "HUP", 8],
    ["SIGINT", "INT", 9],
  ] as const)(
    "%s sent to the launcher reaches the session, and its exit code is the launcher's",
    async (signal, word, code) => {
      expect(await signalLauncher(signal)).toEqual({ code, got: word });
    },
  );
});

describe("RV3: launch says what its settings file leaves in place (the lead's choice: warn, still start)", () => {
  /** Writes a settings file holding `body`, making its folder. */
  function settingsAt(file: string, body: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  }
  const userFile = (home: World) => join(home.home, ".claude", "settings.json");

  test("--no-gateway: a login key in the user's file is named with its file and the fix; the session still starts", async () => {
    const home = world();
    settingsAt(userFile(home), { env: { ANTHROPIC_API_KEY: "sk-ant-test-0123456789" } });
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([
      "launch: ANTHROPIC_API_KEY is set in ~/.claude/settings.json: this session bills through it, not through your plan's login. Remove it from that file to use the login.",
    ]);
    expect(runLog(home)).toContain(`arg=${settingsFileOf(home, "no-gateway")}`);
  });

  test("a helper and a token in the project's own file are named too, one line each, with that file", async () => {
    const home = world();
    const team = join(realpathSync(home.cwd), ".claude", "settings.json");
    settingsAt(team, { apiKeyHelper: "/bin/true", env: { ANTHROPIC_AUTH_TOKEN: "token-value" } });
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([
      `launch: ANTHROPIC_AUTH_TOKEN is set in ${team}: this session bills through it, not through your plan's login. Remove it from that file to use the login.`,
      `launch: apiKeyHelper is set in ${team}: this session bills through it, not through your plan's login. Remove it from that file to use the login.`,
    ]);
  });

  test("a login key is named in the gateway modes too: the gateway sends your own login", async () => {
    const home = world();
    gatewayConfig(home, ["cheap"]);
    settingsAt(userFile(home), { env: { ANTHROPIC_API_KEY: "sk-ant-test-0123456789" } });
    const ctx = context(home);
    expect(await runLaunch(["--gateway"], ctx)).toBe(7);
    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0]).toStartWith(
      "launch: ANTHROPIC_API_KEY is set in ~/.claude/settings.json",
    );
    const profile = context(home);
    expect(await runLaunch(["--profile", "cheap"], profile)).toBe(7);
    expect(profile.errors).toHaveLength(1);
  });

  test("--no-gateway: a retired model key that names a slot is named; a model name Anthropic knows is not", async () => {
    const home = world();
    settingsAt(userFile(home), {
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker",
      },
    });
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([
      'launch: env.ANTHROPIC_DEFAULT_SONNET_MODEL is "cc-smart-dev-kit-worker" in ~/.claude/settings.json: Anthropic has no model of that name, so the requests that use it fail. Remove it from that file (cc-smart-dev-kit gateway setup removes the ones 0.4.3 wrote).',
    ]);
  });

  test("--no-gateway: a model key another file overrides is not named; the file that wins is (chain order)", async () => {
    const team = (home: World) => join(realpathSync(home.cwd), ".claude", "settings.json");
    // The project's file comes before the user's file: its real model wins over the user's slot name.
    const shadowed = world();
    settingsAt(userFile(shadowed), {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker" },
    });
    settingsAt(team(shadowed), { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" } });
    const quiet = context(shadowed);
    expect(await runLaunch(["--no-gateway"], quiet)).toBe(7);
    expect(quiet.errors).toEqual([]);
    // The reverse: the project's slot name wins over the user's real model, and its file is named.
    const winning = world();
    settingsAt(userFile(winning), { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" } });
    settingsAt(team(winning), {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker" },
    });
    const named = context(winning);
    expect(await runLaunch(["--no-gateway"], named)).toBe(7);
    expect(named.errors).toHaveLength(1);
    expect(named.errors[0]).toStartWith(
      `launch: env.ANTHROPIC_DEFAULT_SONNET_MODEL is "cc-smart-dev-kit-worker" in ${team(winning)}:`,
    );
    // Another key is its own: the user's slot name for Haiku stands though the project set Sonnet.
    const apart = world();
    settingsAt(userFile(apart), {
      env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc-smart-dev-kit-scout" },
    });
    settingsAt(team(apart), { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" } });
    const one = context(apart);
    expect(await runLaunch(["--no-gateway"], one)).toBe(7);
    expect(one.errors).toHaveLength(1);
    expect(one.errors[0]).toStartWith(
      'launch: env.ANTHROPIC_DEFAULT_HAIKU_MODEL is "cc-smart-dev-kit-scout" in ~/.claude/settings.json:',
    );
  });

  test("FX1: a higher file that sets a model key to an empty text blanks the lower file's slot name: it is not named", async () => {
    // Proved on Claude Code 2.1.310 (offline probe, `docs/claude-code-contract.md`): an empty text in
    // the file that wins replaces the lower file's value, for `model` and for an env key alike,
    // and the session runs on its default model, not on the lower file's name.
    const team = (home: World) => join(realpathSync(home.cwd), ".claude", "settings.json");
    const blanked = world();
    settingsAt(userFile(blanked), {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker" },
      model: "cc-smart-dev-kit-opus",
    });
    settingsAt(team(blanked), { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "" }, model: "" });
    const quiet = context(blanked);
    expect(await runLaunch(["--no-gateway"], quiet)).toBe(7);
    expect(quiet.errors).toEqual([]);
    // Control: the same lower file with no higher file is named, both keys.
    const alone = world();
    settingsAt(userFile(alone), {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker" },
      model: "cc-smart-dev-kit-opus",
    });
    const named = context(alone);
    expect(await runLaunch(["--no-gateway"], named)).toBe(7);
    expect(named.errors.map((line) => line.split(" is ")[0])).toEqual([
      "launch: model",
      "launch: env.ANTHROPIC_DEFAULT_SONNET_MODEL",
    ]);
  });

  test("FX1: `launch -- --model <id>` overrides a file's `model`: it is not named; the env keys still are", async () => {
    const withModel = (args: string[]) => {
      const home = world();
      settingsAt(userFile(home), {
        env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc-smart-dev-kit-scout" },
        model: "cc-smart-dev-kit-opus",
      });
      return { args, ctx: context(home) };
    };
    for (const args of [
      ["--no-gateway", "--", "--model", "haiku"],
      ["--no-gateway", "--", "--model=haiku"],
    ]) {
      const run = withModel(args);
      expect(await runLaunch(run.args, run.ctx)).toBe(7);
      expect(run.ctx.errors.map((line) => line.split(" is ")[0])).toEqual([
        "launch: env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      ]);
    }
    // The argument after a prompt's own `--` is the prompt, not a flag: `model` stays named.
    const prompt = withModel(["--no-gateway", "--", "-p", "--", "--model"]);
    expect(await runLaunch(prompt.args, prompt.ctx)).toBe(7);
    expect(prompt.ctx.errors.map((line) => line.split(" is ")[0])).toEqual([
      "launch: model",
      "launch: env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]);
    // No `--model`: both are named.
    const plain = withModel(["--no-gateway"]);
    expect(await runLaunch(plain.args, plain.ctx)).toBe(7);
    expect(plain.ctx.errors).toHaveLength(2);
  });

  test("a file whose address is malformed still tells what else it sets: its login key is named", async () => {
    const home = world();
    const team = join(realpathSync(home.cwd), ".claude", "settings.json");
    settingsAt(team, {
      env: { ANTHROPIC_API_KEY: "sk-ant-test-0123456789", ANTHROPIC_BASE_URL: 42 },
    });
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([
      `launch: ANTHROPIC_API_KEY is set in ${team}: this session bills through it, not through your plan's login. Remove it from that file to use the login.`,
    ]);
  });

  test("a slot name is fine on the gateway, and a launch with no mode is the settings' own: no note", async () => {
    const home = world();
    gatewayConfig(home, []);
    settingsAt(userFile(home), {
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test-0123456789",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker",
      },
    });
    const gateway = context(home);
    expect(await runLaunch(["--gateway"], gateway)).toBe(7);
    expect(gateway.errors.map((line) => line.split(" is ")[0])).toEqual([
      "launch: ANTHROPIC_API_KEY",
    ]);
    const plain = context(home);
    expect(await runLaunch([], plain)).toBe(7);
    expect(plain.errors).toEqual([]);
  });

  test("a settings file that cannot be read says nothing here, and the session still starts", async () => {
    const home = world();
    settingsAt(userFile(home), "{not json");
    const ctx = context(home);
    expect(await runLaunch(["--no-gateway"], ctx)).toBe(7);
    expect(ctx.errors).toEqual([]);
  });
});
