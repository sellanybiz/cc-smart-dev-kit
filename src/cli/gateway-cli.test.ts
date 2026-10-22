/**
 * `cc-smart-dev-kit gateway …` end to end, as a person runs it: a temp HOME and config folder,
 * a fake `systemctl` alone on PATH (it logs each call and keeps the unit's state in a
 * file), and a fake backend and router health page served by this test on a free port.
 *
 * Nothing here reaches the real systemd, the real ~/.claude or a real gateway: PATH holds
 * only the fake, and every config this file writes names the fake server's port. A command
 * that would ask the default port (setup or `on` with no config) runs in this process
 * instead (`runHere`), with a fake health page. Never run the router, `setup`, `on`,
 * `status`, or a `restore` that stops the router, as a subprocess without such a config:
 * the default port belongs to a router that may be running on this machine. The port
 * guard (src/testing/port-guard.ts) fails any test that tries. A `restore` that stops the
 * router runs in this process anyway: it waits for the port to close, and the fake server
 * here never closes.
 */
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { runGateway } from "../gateway/commands";
import { gatewayChecks } from "../gateway/doctor";
import type { HealthFetch, HealthProbe } from "../gateway/health";
import { createHistoryWriter } from "../gateway/history";
import { shellQuote } from "../setup/launcher";
import { applyManagedJson } from "../setup/managed-json";
import { listBackups } from "../setup/write";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { cliPaths } from "./paths";
import { runRestore, stageOneDone } from "./restore";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const BUILT_ROUTER = join(import.meta.dir, "..", "..", "plugin", "dist", "router.js");
/** This repo's own CLI bundle: what stage 1 names as the second restore. */
const BUILT_CLI = join(import.meta.dir, "..", "..", "plugin", "dist", "cli.js");
/** A made-up backend key: it must never show in any output. */
const PLANTED_KEY = "sk-planted-SECRET-0123456789abcdef";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/**
 * A fake OmniRoute (`/v1/models` and the judge test's `/v1/messages`) and a fake router health
 * page, on one free port.
 */
function fakeServer(
  options: {
    /** What the health page says about open breakers (`breakers`). */
    breakers?: Record<string, unknown>;
    judge?: Record<string, "allow" | "block">;
    modelsStatus?: number;
  } = {},
) {
  const seenKeys: string[] = [];
  /** Each judge test request: its model, the key it carried, and its body. */
  const judged: { body: Record<string, unknown>; key: string; model: string }[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/v1/messages" && options.judge !== undefined) {
        const body = (await req.json()) as Record<string, unknown>;
        const model = String(body.model);
        judged.push({ body, key: req.headers.get("authorization") ?? "", model });
        const verdict = options.judge[model];
        if (verdict === undefined) return new Response("no such model", { status: 404 });
        return Response.json({
          content: [{ text: verdict === "block" ? "<block>yes" : "<block>no", type: "text" }],
          role: "assistant",
          type: "message",
        });
      }
      if (url.pathname === "/v1/models") {
        seenKeys.push(req.headers.get("authorization") ?? "");
        if (options.modelsStatus !== undefined && options.modelsStatus !== 200) {
          return new Response("no", { status: options.modelsStatus });
        }
        return Response.json({
          data: [
            { id: "m1" },
            { context_length: 200000, id: "m2" },
            { id: "ollama-cloud/glm-5.3-flash" },
          ],
        });
      }
      if (url.pathname === "/__cc-smart-dev-kit/health") {
        return Response.json({
          ...(options.breakers === undefined ? {} : { breakers: options.breakers }),
          cooling: {},
          fallbacks: 0,
          ok: true,
          port: server.port,
          requests: 3,
          uptimeSec: 7,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  return { judged, port: server.port as number, seenKeys };
}

/** Another program on a free port: it answers, but not as this router (an older one, say). */
function otherProgram() {
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("not found", { status: 404 }),
  });
  servers.push(server);
  return { port: server.port as number };
}

/**
 * A temp machine: HOME, config folder, a fake systemctl alone on PATH — or, with
 * `windows: true`, the machine a Windows one is to the CLI: a fake Task Scheduler answering
 * in place of `powershell` (`task`), and no systemd at all. Nothing here reaches the real
 * Task Scheduler, PowerShell or systemctl, or a real gateway.
 */
function machine(
  options: {
    systemctl?: boolean;
    windows?: boolean;
    /** What `GET /v1/models` answers for a key check: 200 accepts, 401 refuses, 503 cannot judge. */
    modelsStatus?: number;
    /** What `POST /api/auth/login` answers: 200 sets the session cookie, 401 refuses the password. */
    loginStatus?: number;
    /** Nothing answers at all (a machine with no OmniRoute). */
    silent?: boolean;
    /** `/api/keys` answers 201 with no key in it. */
    noCreatedKey?: boolean;
    /** `DELETE /api/keys/<id>` answers this instead of 200. */
    deleteStatus?: number;
  } = {},
) {
  const home = tempDir("gateway-cli");
  const configDir = join(home, ".claude");
  mkdirSync(configDir, { recursive: true });
  const fakeBin = join(home, "fake-bin");
  mkdirSync(fakeBin);
  const log = join(home, "systemctl.log");
  const state = join(home, "unit-state");
  const socketState = join(home, "socket-state");
  const taskPath = join(home, ".local", "share", "cc-smart-dev-kit", "router-task.xml");
  /**
   * The fake Task Scheduler a Windows machine talks to: the state a real one would hold,
   * and the calls that changed it. `register` reads the definition file back, so the driver
   * sees what setup wrote.
   */
  const task: {
    action: null | { arguments: string; execute: string; workingDirectory: string };
    lastResult: null | number;
    registered: boolean;
    state: string;
  } = { action: null, lastResult: 267011, registered: false, state: "Ready" };
  const taskCalls: string[] = [];
  const windowsRunner = (cmd: string[]) => {
    const script = cmd.at(-1) ?? "";
    if (script.includes("Get-ScheduledTaskInfo")) {
      taskCalls.push("query");
      if (!task.registered) return { exitCode: 0, output: "registered=false\n" };
      const action = task.action;
      return {
        exitCode: 0,
        output: [
          "registered=true",
          `state=${task.state}`,
          `last=${String(task.lastResult)}`,
          `execute=${action?.execute ?? ""}`,
          `arguments=${action?.arguments ?? ""}`,
          `working=${action?.workingDirectory ?? ""}`,
          "",
        ].join("\n"),
      };
    }
    if (script.startsWith("Register-ScheduledTask")) {
      taskCalls.push("register");
      const xml = existsSync(taskPath) ? readFileSync(taskPath, "utf8") : "";
      const pick = (tag: string) =>
        (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? "")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&");
      task.action = {
        arguments: pick("Arguments"),
        execute: pick("Command"),
        workingDirectory: pick("WorkingDirectory"),
      };
      task.registered = true;
      task.state = "Ready";
      return { exitCode: 0, output: "" };
    }
    if (script.startsWith("Start-ScheduledTask")) {
      taskCalls.push("start");
      task.state = "Running";
      return { exitCode: 0, output: "" };
    }
    if (script.startsWith("Stop-ScheduledTask")) {
      taskCalls.push("stop");
      task.state = "Ready";
      return { exitCode: 0, output: "" };
    }
    if (script.startsWith("Unregister-ScheduledTask")) {
      taskCalls.push("unregister");
      task.registered = false;
      task.state = "Ready";
      return { exitCode: 0, output: "" };
    }
    taskCalls.push(`unknown: ${script}`);
    return { exitCode: 0, output: "" };
  };
  if (options.systemctl !== false && options.windows !== true) {
    // Shell builtins only: PATH holds nothing else. The service and its socket each keep
    // their own state; a command acts on the units it names.
    writeFileSync(
      join(fakeBin, "systemctl"),
      [
        "#!/bin/sh",
        `echo "$*" >> '${log}'`,
        "s=inactive",
        `[ -e '${state}' ] && read s < '${state}'`,
        "k=inactive",
        `[ -e '${socketState}' ] && read k < '${socketState}'`,
        "set_to() {",
        `  case "$2" in *.service*) echo "$1" > '${state}' ;; esac`,
        `  case "$2" in *.socket*) echo "$1" > '${socketState}' ;; esac`,
        "}",
        'case "$*" in',
        '  *is-active*) [ "$1" = "--user" ] || exit 9; case "$*" in *.socket*) w=$k ;; *) w=$s ;; esac; case "$*" in *--quiet*) ;; *) echo "$w" ;; esac; [ "$w" = active ] && exit 0; exit 3 ;;',
        // `disable` alone leaves a running unit running, as systemd does; `stop` stops it.
        '  *disable*--now*|*" stop "*) set_to inactive "$*" ;;',
        `  *" restart "*) echo active > '${state}' ;;`,
        '  *" start "*|*--now*) set_to active "$*" ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(fakeBin, "systemctl"), 0o755);
  }
  const env = { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: fakeBin };
  // The live-router guard runs in the CLI too: no test may reach port 20100.
  const guard = subprocessGuard();
  const run = async (args: string[], input?: string, cli = CLI) => {
    const proc = Bun.spawn([process.execPath, ...guard.args, cli, ...args], {
      env: { ...env, ...guard.env },
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  };
  const paths = {
    config: join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
    copy: join(home, ".local", "share", "cc-smart-dev-kit", "router.js"),
    history: join(home, ".local", "state", "cc-smart-dev-kit", "history.db"),
    unit: join(home, ".config", "systemd", "user", "cc-smart-dev-kit-router.service"),
    socket: join(home, ".config", "systemd", "user", "cc-smart-dev-kit-router.socket"),
    settings: join(configDir, "settings.json"),
    stateDir: join(configDir, "cc-smart-dev-kit"),
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");

  /**
   * The fetch every gateway command's OWN extra calls use (`GatewayContext.apiFetch`): the key
   * check (`GET /v1/models` with the key), OmniRoute's dashboard (`POST /api/auth/login`, then
   * `POST /api/keys` with the session cookie) and the keyless liveness probe. Every call is
   * recorded with its method, its cookie and whether an Origin header was sent, so a test can
   * pin the shape OmniRoute's own rules need. No test reaches 127.0.0.1:20128, where a real
   * OmniRoute may run on this machine.
   */
  const apiCalls: {
    body: unknown;
    cookie: null | string;
    method: string;
    origin: null | string;
    url: string;
  }[] = [];
  const apiFetch: HealthFetch = async (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    let body: unknown = null;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    apiCalls.push({
      body,
      cookie: headers.cookie ?? null,
      method: init.method ?? "GET",
      origin: headers.origin ?? null,
      url,
    });
    // Nothing listens: what a machine with no OmniRoute does.
    if (options.silent === true) {
      throw Object.assign(
        new TypeError("Unable to connect. Is the computer able to access the url?"),
        {
          code: "ConnectionRefused",
        },
      );
    }
    if (url.includes("/v1/models")) {
      const status = options.modelsStatus ?? 200;
      return status === 200
        ? Response.json({ data: [{ id: "m1" }] })
        : new Response("no", { status });
    }
    if (url.includes("/api/auth/login")) {
      const status = options.loginStatus ?? 200;
      if (status !== 200) return Response.json({ error: "Invalid password" }, { status });
      return Response.json(
        { success: true },
        { headers: { "set-cookie": "auth_token=session-abc; Path=/; HttpOnly; SameSite=Lax" } },
      );
    }
    if (url.includes("/api/keys")) {
      // `DELETE /api/keys/<id>`: OmniRoute removes a key again. A setup that made one and did
      // NOT save it calls this, so the person's dashboard keeps no unused key.
      if ((init.method ?? "GET") === "DELETE") {
        return options.deleteStatus === undefined
          ? new Response("", { status: 200 })
          : new Response("no", { status: options.deleteStatus });
      }
      if (options.noCreatedKey === true) return Response.json({ id: "key-1" }, { status: 201 });
      return Response.json(
        { id: "key-1", key: "omni-key-made-here", name: "cc-smart-dev-kit-router-test" },
        { status: 201 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  /**
   * The router health page, faked for `runHere`: this router answers while the fake unit
   * is active (or while `port.held`: a router that does not let go), another program
   * answers 404 while `port.other`, and nothing listens otherwise. Each URL asked is
   * recorded. Its clock moves only when the code sleeps. No network.
   */
  const probed: string[] = [];
  const port = { held: false, other: false };
  const clock = { now: Date.UTC(2026, 9, 15, 10, 0, 0) };
  const probe: HealthProbe = {
    fetch: async (url) => {
      probed.push(url);
      if (port.other) return new Response("not found", { status: 404 });
      // A Windows machine has no unit: its task holds the port while its router runs.
      const unit =
        options.windows === true
          ? task.state === "Running"
            ? "active"
            : "inactive"
          : existsSync(state)
            ? readFileSync(state, "utf8").trim()
            : "inactive";
      if (unit === "active" || port.held) return Response.json({ ok: true });
      throw Object.assign(
        new TypeError("Unable to connect. Is the computer able to access the url?"),
        {
          code: "ConnectionRefused",
        },
      );
    },
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  };
  /** The fake systemctl, called the way the CLI's own runner calls the real one. */
  const runner = (cmd: string[]) => {
    const result = Bun.spawnSync([join(fakeBin, "systemctl"), ...cmd.slice(1)], {
      env: { PATH: fakeBin },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };
  /**
   * `cc-smart-dev-kit gateway …` or `cc-smart-dev-kit restore …` in this process, for a command that
   * asks a port: the same temp machine and fake systemctl, but the fake health page
   * above, so no test reaches a router that may run on this machine (and a stopped unit
   * frees its port, which a fake server in this process cannot do for a subprocess).
   * Output as the CLI prints it.
   */
  const runHere = async (
    args: string[],
    input?: string,
    how: { readSecret?: () => Promise<null | string> } = {},
  ) => {
    if (args[0] !== "gateway" && args[0] !== "restore") {
      throw new Error("runHere runs `gateway …` and `restore …` commands only");
    }
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
    const out: string[] = [];
    const err: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      out.push(`${parts.join(" ")}\n`);
    });
    const error = spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      err.push(`${parts.join(" ")}\n`);
    });
    let exitCode: number;
    try {
      exitCode =
        args[0] === "restore"
          ? await runRestore(paths, {
              yes: args.includes("--yes"),
              now: args.includes("--now"),
              cliBundle: BUILT_CLI,
              runner: options.windows === true ? windowsRunner : runner,
              service:
                options.windows === true
                  ? "scheduled-task"
                  : options.systemctl === false
                    ? "none"
                    : "systemd",
              confirm: null,
              probe,
            })
          : await runGateway(args.slice(1), {
              paths,
              bunPath: process.execPath,
              // The Bun running the tests: the preload stops an older one.
              bunVersion: Bun.version,
              bundle: BUILT_ROUTER,
              runner: options.windows === true ? windowsRunner : runner,
              readStdin: () => Promise.resolve(input ?? ""),
              // A terminal that can hide what is typed, when a test says so: the real entry
              // builds this with `gatewayContext` (`src/gateway/context.ts`), whose own test
              // proves a terminal-shaped stdin gets it.
              ...(how.readSecret === undefined ? {} : { readSecret: how.readSecret }),
              confirm: null,
              service:
                options.windows === true
                  ? "scheduled-task"
                  : options.systemctl === false
                    ? "none"
                    : "systemd",
              account: options.windows === true ? "MACHINE\\user" : null,
              platform: options.windows === true ? "win32" : "linux",
              probe,
              // Every extra network call a gateway command makes (the key check, OmniRoute's
              // dashboard, the liveness probe) goes through this fake: no test reaches a real
              // backend, and 127.0.0.1:20128 may belong to an OmniRoute running here.
              apiFetch,
              // Where a command's own lines go: `out` and `err` are what the tests assert on.
              print: (line: string) => out.push(`${line}\n`),
              error: (line: string) => err.push(`${line}\n`),
            });
    } catch (thrown) {
      // What the CLI's own catch prints (src/entries/cli.ts).
      err.push(`cc-smart-dev-kit: ${thrown instanceof Error ? thrown.message : String(thrown)}\n`);
      exitCode = 1;
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    return { exitCode, stdout: out.join(""), stderr: err.join("") };
  };
  /** Points the config at the fake server, as a person would edit it. */
  const useServer = (port: number, extra: Record<string, unknown> = {}) => {
    const config = JSON.parse(readFileSync(paths.config, "utf8"));
    config.port = port;
    config.backends.omniroute.baseUrl = `http://127.0.0.1:${port}`;
    writeFileSync(paths.config, JSON.stringify({ ...config, ...extra }, null, 2), { mode: 0o600 });
  };
  /** A config written by hand, on the fake server's port. */
  const writeConfig = (
    port: number,
    slots: Record<string, string[]> = {},
    extra: Record<string, unknown> = {},
  ) => {
    mkdirSync(dirname(paths.config), { recursive: true });
    writeFileSync(
      paths.config,
      JSON.stringify({
        backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: `http://127.0.0.1:${port}` } },
        port,
        slots: { "cc-smart-dev-kit-scout": ["omniroute:m1", "claude-sonnet-5-5"], ...slots },
        version: 1,
        ...extra,
      }),
      { mode: 0o600 },
    );
  };
  return {
    home,
    configDir,
    env,
    run,
    runHere,
    task,
    taskCalls,
    taskPath,
    windowsRunner,
    probe,
    probed,
    port,
    clock,
    paths,
    calls,
    state,
    useServer,
    writeConfig,
    apiCalls,
    apiFetch,
  };
}

describe("cc-smart-dev-kit gateway setup on a machine an older version set up", () => {
  test("drops 0.4.x's hidden Claude step from a default chain, takes out 0.4.3's model keys, says to restart", async () => {
    const m = machine();
    const server = fakeServer();
    const oldDefault = [
      "omniroute:ollama-cloud/deepseek-v4.1-flash",
      "omniroute:ollama-cloud/glm-5.3-flash",
      "claude-sonnet-5-5",
    ];
    // Scout as 0.4.x wrote it; worker as the person changed it (Claude Sonnet stays theirs).
    m.writeConfig(server.port, {
      "cc-smart-dev-kit-scout": oldDefault,
      "cc-smart-dev-kit-worker": ["omniroute:m1", "claude-sonnet-5-5"],
    });
    const paths = cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir });
    writeFileSync(m.paths.settings, '{\n  "model": "opus"\n}\n');
    // As 0.4.3's `gateway on` left the settings: its model keys, owned.
    applyManagedJson({
      file: m.paths.settings,
      set: [
        [["env", "ANTHROPIC_DEFAULT_HAIKU_MODEL"], "cc-smart-dev-kit-scout[1m]"],
        [["env", "ANTHROPIC_DEFAULT_SONNET_MODEL"], "cc-smart-dev-kit-worker[1m]"],
      ],
      stateDir: paths.stateDir,
    });
    const done = await m.run(["gateway", "setup"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain(
      "~ cc-smart-dev-kit-scout: took out claude-sonnet-5-5, the Claude model 0.4.x put at the end of its default chain; no Claude model answers there unless you put one in (cc-smart-dev-kit gateway slot scout <targets>)\n",
    );
    expect(done.stdout).not.toContain("~ cc-smart-dev-kit-worker:");
    expect(done.stdout).toContain(
      [
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc-smart-dev-kit-scout[1m]" -> (none)',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_SONNET_MODEL: "cc-smart-dev-kit-worker[1m]" -> (none)',
        // The `env` those keys made goes with them: the person had none.
        "~ ~/.claude/settings.json: env: {} -> (none)",
        "Restart every open Claude session now: until it restarts, a session may still send haiku / sonnet work by the slot's old name.",
        "",
      ].join("\n"),
    );
    const config = JSON.parse(readFileSync(m.paths.config, "utf8")) as {
      slots: Record<string, string[]>;
    };
    expect(config.slots).toEqual({
      "cc-smart-dev-kit-scout": oldDefault.slice(0, 2),
      "cc-smart-dev-kit-worker": ["omniroute:m1", "claude-sonnet-5-5"],
    });
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus" });
    // A second run has nothing left to change, and says nothing about it.
    const again = await m.run(["gateway", "setup"]);
    expect(again.stdout).not.toContain("took out");
    expect(again.stdout).not.toContain("Restart every open Claude session now");
  });
});

describe("cc-smart-dev-kit gateway setup", () => {
  // Reworked: runs in this process (`runHere`). With no config the router listens on the
  // default port, and setup now asks that port first: a subprocess would reach a router
  // that may run on this machine. Every assertion is kept; the port asked is new.
  test("installs the copy and the unit, starts it, and changes nothing the second time", async () => {
    const m = machine();
    const first = await m.runHere(["gateway", "setup", "--no-backend-key"]);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe(
      [
        `no config at ~/.config/cc-smart-dev-kit/gateway.json yet: every slot is off, so every Claude model goes to Anthropic as Claude Code sent it, on your own login, until the OmniRoute key is added (setup --backend-key-stdin omniroute)`,
        "+ ~/.local/share/cc-smart-dev-kit/router.js: router copy created",
        "+ ~/.config/systemd/user/cc-smart-dev-kit-router.service: unit created",
        "+ ~/.config/systemd/user/cc-smart-dev-kit-router.socket: socket unit created",
        "enabled and (re)started cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket",
        "Claude Code does not use the gateway yet. Check it: cc-smart-dev-kit gateway status. Then: cc-smart-dev-kit gateway on.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.copy).equals(readFileSync(BUILT_ROUTER))).toBe(true);
    expect(readFileSync(m.paths.unit, "utf8")).toContain(
      `\nExecStart="${process.execPath}" --no-env-file "${m.paths.copy}"\n`,
    );
    expect(readFileSync(m.paths.socket, "utf8")).toContain("\nListenStream=127.0.0.1:20100\n");
    expect(existsSync(m.paths.config)).toBe(false);
    expect(m.calls()).toBe(
      [
        // The read-only pass, then the writing pass, each asks the socket and the unit.
        "--user is-active --quiet cc-smart-dev-kit-router.socket",
        "--user is-active --quiet cc-smart-dev-kit-router.service",
        "--user is-active --quiet cc-smart-dev-kit-router.socket",
        "--user is-active --quiet cc-smart-dev-kit-router.service",
        "--user daemon-reload",
        "--user enable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        // A unit that is not active is asked its state, to say when an old router
        // still drains; nothing runs, so nothing is stopped. Changed on purpose: the
        // socket opens the port first, then the router starts on it.
        "--user is-active cc-smart-dev-kit-router.service",
        "--user reset-failed cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user start cc-smart-dev-kit-router.socket",
        "--user start cc-smart-dev-kit-router.service",
        "",
      ].join("\n"),
    );
    // No config: the default port. Asked of the fake, before each pass and after the restart.
    expect(m.probed).toEqual([
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
    ]);

    const again = await m.runHere(["gateway", "setup", "--no-backend-key"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("router already up to date (no restart)\n");
    expect(
      m
        .calls()
        .endsWith(
          "--user enable --now cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service\n",
        ),
    ).toBe(true);
  });

  // Reworked: a config on the fake server's port first, so setup asks that port, never
  // the default one. Every assertion is kept.
  test("a running router with a changed copy: no restart without --yes; with --yes, the restart", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    writeFileSync(m.paths.copy, "// an older router\n");
    const before = m.calls();
    const refused = await m.run(["gateway", "setup"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe(
      [
        "cc-smart-dev-kit-router is running. A restart lets its answers in flight finish first (up to 120 s; a longer one is cut, and Claude Code retries it). New requests wait in its socket meanwhile; none fails.",
        "Nothing was changed. Run again with --yes to restart: cc-smart-dev-kit gateway setup --yes",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.copy, "utf8")).toBe("// an older router\n");
    expect(m.calls().slice(before.length)).toBe(
      "--user is-active --quiet cc-smart-dev-kit-router.socket\n--user is-active --quiet cc-smart-dev-kit-router.service\n",
    );

    const yes = await m.run(["gateway", "setup", "--yes"]);
    expect(yes.exitCode).toBe(0);
    expect(yes.stdout).toContain(
      "cc-smart-dev-kit-router is running. A restart lets its answers in flight finish first (up to 120 s; a longer one is cut, and Claude Code retries it). New requests wait in its socket meanwhile; none fails.\n",
    );
    expect(yes.stdout).toContain(
      "~ ~/.local/share/cc-smart-dev-kit/router.js: router copy updated\n",
    );
    expect(yes.stdout).toContain(
      "restarting cc-smart-dev-kit-router (new requests wait in its socket)\n",
    );
    expect(m.calls().endsWith("--user restart cc-smart-dev-kit-router.service\n")).toBe(true);
    expect(readFileSync(m.paths.copy).equals(readFileSync(BUILT_ROUTER))).toBe(true);
  });

  test("no systemd: a clear message, and nothing is written", async () => {
    const m = machine({ systemctl: false });
    const result = await m.run(["gateway", "setup", "--no-backend-key"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("the gateway service needs systemd (Linux) for now.\n");
    expect(existsSync(join(m.home, ".local"))).toBe(false);
    expect(existsSync(join(m.home, ".config"))).toBe(false);
  });

  // Reworked: runs in this process (`runHere`): the new config names the default port,
  // which setup now asks first. Every assertion is kept.
  test("the key comes on stdin, never argv; the config is mode 600", async () => {
    const m = machine();
    const result = await m.runHere(
      ["gateway", "setup", "--backend-key-stdin", "omniroute"],
      `${PLANTED_KEY}\n`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe(
      "created ~/.config/cc-smart-dev-kit/gateway.json (mode 600)",
    );
    expect(statSync(m.paths.config).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(m.paths.config, "utf8")).backends.omniroute.apiKey).toBe(
      PLANTED_KEY,
    );
    // A key as an argument is a wrong option, not a key.
    const argv = await m.runHere([
      "gateway",
      "setup",
      "--backend-key-stdin",
      "omniroute",
      PLANTED_KEY,
    ]);
    expect(argv.exitCode).toBe(2);
    expect(`${argv.stdout}${argv.stderr}`).not.toContain(PLANTED_KEY);
  });
});

describe("cc-smart-dev-kit gateway setup: the key is tested before it is saved", () => {
  // Live, 2026-10-17: a person pasted their Ollama Cloud key where the router's OmniRoute key
  // was asked for. It was saved without a check, the router's backend answered 401 to every
  // request after that, and every affordable subagent fell back to Claude.
  const OLD_KEY = "the-router-key-that-works";

  test("a key the backend refuses: refused, nothing written, the key in the file kept", async () => {
    const m = machine({ modelsStatus: 401 });
    const result = await m.runHere(
      ["gateway", "setup", "--backend-key-stdin", "omniroute"],
      "an-ollama-cloud-key\n",
    );
    expect(result.exitCode).toBe(1);
    // The refusal says which key OmniRoute wants, and how to give it, and it never prints the
    // key that was given.
    expect(result.stderr).toContain("omniroute answered HTTP 401 for this key");
    expect(result.stderr).toContain(
      "omniroute\" wants an OmniRoute API key: the key the router itself uses, made in OmniRoute's own dashboard (its API keys page)",
    );
    expect(result.stderr).toContain(
      "cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("an-ollama-cloud-key");
    // Nothing was created: no config, no router copy, no unit.
    expect(existsSync(m.paths.config)).toBe(false);
    expect(existsSync(join(m.home, ".local"))).toBe(false);
  });

  test("an existing key that the new one would replace: the file as it was is kept as a backup", async () => {
    const m = machine();
    m.writeConfig(20177);
    const config = JSON.parse(readFileSync(m.paths.config, "utf8")) as {
      backends: { omniroute: { apiKey: string } };
    };
    config.backends.omniroute.apiKey = OLD_KEY;
    writeFileSync(m.paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });
    const result = await m.runHere(
      ["gateway", "setup", "--backend-key-stdin", "omniroute"],
      "a-new-good-key\n",
    );
    expect(result.exitCode).toBe(0);
    expect(
      (
        JSON.parse(readFileSync(m.paths.config, "utf8")) as {
          backends: { omniroute: { apiKey: string } };
        }
      ).backends.omniroute.apiKey,
    ).toBe("a-new-good-key");
    // The file as it was BEFORE the change is in the state folder, and the line says where.
    const backups = listBackups(m.paths.stateDir, m.paths.config);
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0]?.path ?? "", "utf8")).toContain(OLD_KEY);
    expect(result.stdout).toContain("the file as it was before the change is in ");
    expect(`${result.stdout}${result.stderr}`).not.toContain("a-new-good-key");
  });

  test("the same key again: no backup piles up", async () => {
    const m = machine();
    m.writeConfig(20177);
    const config = JSON.parse(readFileSync(m.paths.config, "utf8")) as {
      backends: { omniroute: { apiKey: string } };
    };
    config.backends.omniroute.apiKey = OLD_KEY;
    writeFileSync(m.paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });
    expect(
      (await m.runHere(["gateway", "setup", "--backend-key-stdin", "omniroute"], `${OLD_KEY}\n`))
        .exitCode,
    ).toBe(0);
    expect(listBackups(m.paths.stateDir, m.paths.config)).toEqual([]);
  });

  test("a backend that cannot be asked: refused without --save-unchecked, saved with it", async () => {
    const refused = machine({ modelsStatus: 503 });
    const result = await refused.runHere(
      ["gateway", "setup", "--backend-key-stdin", "omniroute"],
      "some-key\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("could not ask omniroute at http://127.0.0.1:20128");
    expect(result.stderr).toContain("/v1/models answered HTTP 503");
    expect(result.stderr).toContain("--save-unchecked");
    expect(existsSync(refused.paths.config)).toBe(false);

    // With the flag the key is saved, and the line says it was never checked.
    const unchecked = machine({ modelsStatus: 503 });
    const saved = await unchecked.runHere(
      ["gateway", "setup", "--backend-key-stdin", "omniroute", "--save-unchecked"],
      "some-key\n",
    );
    expect(saved.exitCode).toBe(0);
    expect(saved.stdout).toContain(
      "WARN the key was saved WITHOUT its backend accepting it (/v1/models answered HTTP 503)",
    );
    expect(saved.stdout).toContain(
      "Check it when the backend answers: cc-smart-dev-kit gateway check",
    );
    expect(existsSync(unchecked.paths.config)).toBe(true);
    expect(`${saved.stdout}${saved.stderr}`).not.toContain("some-key");
  });

  test("--save-unchecked with no key of any kind is a wrong option", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--save-unchecked"])).exitCode).toBe(2);
    expect(
      (await m.runHere(["gateway", "setup", "--no-backend-key", "--save-unchecked"])).exitCode,
    ).toBe(2);
  });
});

describe("cc-smart-dev-kit gateway setup: OmniRoute's dashboard password", () => {
  test("the password makes the router's key: login, create, test, save — and it is never printed", async () => {
    const m = machine();
    const result = await m.runHere(
      ["gateway", "setup", "--omniroute-password-stdin"],
      "the-dashboard-password\n",
    );
    expect(result.exitCode).toBe(0);
    // The name carries this machine's host name: one key per machine, so a person can tell
    // them apart in OmniRoute's dashboard. Built here from node's own `hostname()`, never from
    // the code under test.
    expect(result.stdout).toContain(
      `made the key "cc-smart-dev-kit-router-${hostname()}" in OmniRoute (••••here)`,
    );
    expect(
      (
        JSON.parse(readFileSync(m.paths.config, "utf8")) as {
          backends: { omniroute: { apiKey: string } };
        }
      ).backends.omniroute.apiKey,
    ).toBe("omni-key-made-here");
    // The two dashboard calls, in order: the login (no cookie, NO Origin header — OmniRoute
    // skips its CSRF check for a request without one), then the create with the session cookie.
    expect(m.apiCalls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /api/auth/login",
      "POST /api/keys",
      "GET /v1/models",
    ]);
    expect(m.apiCalls[0]?.body).toEqual({ password: "the-dashboard-password" });
    expect(m.apiCalls[0]?.cookie).toBeNull();
    expect(m.apiCalls[0]?.origin).toBeNull();
    expect(m.apiCalls[1]?.cookie).toBe("auth_token=session-abc");
    expect(m.apiCalls[1]?.origin).toBeNull();
    expect(m.apiCalls[1]?.body).toEqual({
      name: expect.stringContaining("cc-smart-dev-kit-router-"),
      noLog: true,
    });
    // The secret is in no line and in no log.
    expect(`${result.stdout}${result.stderr}`).not.toContain("the-dashboard-password");
  });

  test("a wrong dashboard password: refused, nothing created, nothing written", async () => {
    const m = machine({ loginStatus: 401 });
    const result = await m.runHere(
      ["gateway", "setup", "--omniroute-password-stdin"],
      "not-the-password\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("OmniRoute rejected that dashboard password");
    expect(result.stderr).toContain("Nothing was saved, and the key in ");
    expect(result.stderr).toContain("gateway setup --backend-key-stdin omniroute < key-file");
    // It logged in only; no key was made.
    expect(m.apiCalls.map((call) => new URL(call.url).pathname)).toEqual(["/api/auth/login"]);
    expect(existsSync(m.paths.config)).toBe(false);
    expect(`${result.stdout}${result.stderr}`).not.toContain("not-the-password");
  });

  test("no OmniRoute at all: the line says the gateway needs OmniRoute first", async () => {
    const m = machine({ silent: true });
    const result = await m.runHere(
      ["gateway", "setup", "--omniroute-password-stdin"],
      "the-dashboard-password\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("OmniRoute does not answer at http://127.0.0.1:20128");
    expect(result.stderr).toContain("The gateway needs OmniRoute first");
    expect(existsSync(m.paths.config)).toBe(false);
  });

  test("an answer with no key in it: refused, and the line says so", async () => {
    const m = machine({ noCreatedKey: true });
    const result = await m.runHere(
      ["gateway", "setup", "--omniroute-password-stdin"],
      "the-dashboard-password\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("the answer to creating the key held no key");
    expect(existsSync(m.paths.config)).toBe(false);
  });

  test("--omniroute-password asks on the terminal, with no echo, and saves the key it makes", async () => {
    // The command path the README, the installer and the gateway skill all send people to.
    const m = machine();
    let asked = 0;
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => {
        asked += 1;
        return Promise.resolve("the-dashboard-password");
      },
    });
    expect(asked).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('made the key "cc-smart-dev-kit-router-');
    expect(
      (
        JSON.parse(readFileSync(m.paths.config, "utf8")) as {
          backends: { omniroute: { apiKey: string } };
        }
      ).backends.omniroute.apiKey,
    ).toBe("omni-key-made-here");
    // The password itself was read from the terminal, never printed and never stored.
    expect(`${result.stdout}${result.stderr}`).not.toContain("the-dashboard-password");
    expect(m.apiCalls[0]?.body).toEqual({ password: "the-dashboard-password" });
  });

  test("--omniroute-password with a terminal that cannot hide it: the line says to use stdin", async () => {
    const m = machine();
    // No `readSecret` in the context: what a pipe, or a terminal without `setRawMode`, gives.
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("this terminal cannot hide what you type");
    expect(result.stderr).toContain("gateway setup --omniroute-password-stdin < password-file");
    expect(existsSync(m.paths.config)).toBe(false);
  });

  test("--omniroute-password, Ctrl+C at the prompt: refused, and nothing was made", async () => {
    const m = machine();
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => Promise.resolve(null),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("nothing was read (Ctrl+C)");
    expect(m.apiCalls).toEqual([]);
  });

  test("a key setup made and did not save is DELETED again in OmniRoute", async () => {
    // Live-shaped: the dashboard password makes a key, the backend then refuses it, and the run
    // saves nothing — the key must not be left behind (premium review, 2026-10-17).
    const m = machine({ modelsStatus: 401 });
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => Promise.resolve("the-dashboard-password"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("answered HTTP 401 for this key");
    const removed = m.apiCalls.filter((call) => call.method === "DELETE");
    expect(removed).toHaveLength(1);
    expect(new URL(removed[0]?.url ?? "").pathname).toBe("/api/keys/key-1");
    expect(removed[0]?.cookie).toBe("auth_token=session-abc");
    expect(removed[0]?.origin).toBeNull();
    expect(existsSync(m.paths.config)).toBe(false);
  });

  test("a key that could not be deleted: the error names it, with its id, for the dashboard", async () => {
    const m = machine({ deleteStatus: 500, modelsStatus: 401 });
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => Promise.resolve("the-dashboard-password"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("answered HTTP 401 for this key");
    expect(result.stderr).toContain(
      "WARN the key this run made in OmniRoute could not be removed (cc-smart-dev-kit-router-",
    );
    expect(result.stderr).toContain("id key-1");
    expect(result.stderr).toContain("remove it in OmniRoute's dashboard by hand");
  });

  test("an unchecked save without --save-unchecked: the key goes too", async () => {
    // The other "made but not saved" path: the backend answers 503, so the key cannot be
    // judged, and without `--save-unchecked` nothing is written.
    const m = machine({ modelsStatus: 503 });
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => Promise.resolve("the-dashboard-password"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("could not ask omniroute");
    expect(m.apiCalls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(existsSync(m.paths.config)).toBe(false);
  });

  test("a key that IS saved is not deleted", async () => {
    const m = machine();
    const result = await m.runHere(["gateway", "setup", "--omniroute-password"], undefined, {
      readSecret: () => Promise.resolve("the-dashboard-password"),
    });
    expect(result.exitCode).toBe(0);
    expect(m.apiCalls.filter((call) => call.method === "DELETE")).toEqual([]);
    expect(
      (
        JSON.parse(readFileSync(m.paths.config, "utf8")) as {
          backends: { omniroute: { apiKey: string } };
        }
      ).backends.omniroute.apiKey,
    ).toBe("omni-key-made-here");
  });

  test("the password flag and a key on stdin together, or with --no-backend-key: wrong options", async () => {
    const m = machine();
    expect(
      (
        await m.runHere(
          ["gateway", "setup", "--omniroute-password-stdin", "--backend-key-stdin", "omniroute"],
          "x\n",
        )
      ).exitCode,
    ).toBe(2);
    expect(
      (await m.runHere(["gateway", "setup", "--omniroute-password-stdin", "--no-backend-key"]))
        .exitCode,
    ).toBe(2);
  });
});

describe("cc-smart-dev-kit gateway check: the installer's one question", () => {
  // Exit codes: 0 the key works, 1 there is no OmniRoute key yet and OmniRoute answers, 3 it
  // could not be judged, 4 the key in the file is one OmniRoute refuses. The installer asks for
  // a key only on 1 and 4 (`install.sh`, `install.ps1`).
  test("no config, and OmniRoute answers: 1, and it says one can be made", async () => {
    const m = machine();
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("the gateway has no config yet");
    expect(result.stdout).toContain("OmniRoute answers at http://127.0.0.1:20128");
    expect(result.stdout).toContain("OmniRoute's dashboard password");
  });

  test("no config, and nothing answers: 3, and it says the gateway needs OmniRoute first", async () => {
    const m = machine({ silent: true });
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("OmniRoute does not answer at http://127.0.0.1:20128");
    expect(result.stdout).toContain("the gateway needs OmniRoute first");
  });

  test("a config whose key the backend accepts: 0", async () => {
    const m = machine();
    m.writeConfig(20177);
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "✓ the gateway's OmniRoute key is accepted (http://127.0.0.1:20177, HTTP 200)\n",
    );
    expect(m.apiCalls).toHaveLength(1);
  });

  test("a config whose key the backend refuses: 4, naming both ways to fix it", async () => {
    const m = machine({ modelsStatus: 401 });
    m.writeConfig(20177);
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain(
      "OmniRoute refused the key in ~/.config/cc-smart-dev-kit/gateway.json (HTTP 401)",
    );
    expect(result.stdout).toContain("gateway setup --backend-key-stdin omniroute < key-file");
    expect(result.stdout).toContain("let setup make one with OmniRoute's dashboard password");
  });

  test("a config with no omniroute backend is the same question as no config at all", async () => {
    const m = machine();
    const config = {
      backends: { ollama: { apiKey: "ollama-key", baseUrl: "https://ollama.com" } },
      port: 20177,
      slots: { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] },
      version: 1,
    };
    mkdirSync(dirname(m.paths.config), { recursive: true });
    writeFileSync(m.paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("names no omniroute backend");
  });

  test("a config that cannot be read: 3, with its reason", async () => {
    const m = machine();
    mkdirSync(dirname(m.paths.config), { recursive: true });
    writeFileSync(m.paths.config, "{not json", { mode: 0o600 });
    const result = await m.runHere(["gateway", "check"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("the gateway could not be checked");
    expect(result.stdout).toContain("is not valid JSON");
  });

  test("check takes no options, and asks no port", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "check", "--now"])).exitCode).toBe(2);
    expect(m.probed).toEqual([]);
  });
});

describe("cc-smart-dev-kit gateway setup: the port", () => {
  test("a port another program uses: setup refuses before any question, and writes nothing", async () => {
    const m = machine();
    const other = otherProgram();
    m.writeConfig(other.port);
    const result = await m.run(["gateway", "setup", "--yes"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `cc-smart-dev-kit: port ${other.port} is used by another program (an older router? stop it first)\n`,
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(existsSync(join(m.home, ".claude", "cc-smart-dev-kit"))).toBe(false);
    // Changed on purpose: the socket is asked first, since an open socket of ours holds
    // the port without an answer while its router restarts. It is not open: refused.
    expect(m.calls()).toBe("--user is-active --quiet cc-smart-dev-kit-router.socket\n");
  });
});

describe("cc-smart-dev-kit restore: the gateway in two stages", () => {
  const STAGE_1_KEYS =
    "~ ~/.claude/settings.json: removed env.ENABLE_TOOL_SEARCH, env.ANTHROPIC_BASE_URL, env; everything else kept";

  /**
   * What stage 1 says when it removed the launcher: `cc-smart-dev-kit` is off the PATH, so it
   * names the `bun --no-env-file …` form the README's install step uses.
   */
  const STAGE_1_AGAIN = `Restart every running Claude session (they still use the router), then run restore again — this one removed the launcher (~/.local/bin/cc-smart-dev-kit), so \`cc-smart-dev-kit\` is not on your PATH any more: ${shellQuote(process.execPath)} '--no-env-file' '--config=${join(dirname(dirname(BUILT_CLI)), "bunfig.toml")}' '${BUILT_CLI}' restore`;

  test("stageOneDone: the command that works, with the launcher gone and with it still there", () => {
    const home = tempDir("stage-one");
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
    // No launcher (setup created it, and the first restore removed it): the bun line.
    expect(stageOneDone(paths, "/plugin/dist/cli.js")).toBe(
      `Restart every running Claude session (they still use the router), then run restore again — this one removed the launcher (~/.local/bin/cc-smart-dev-kit), so \`cc-smart-dev-kit\` is not on your PATH any more: ${shellQuote(process.execPath)} '--no-env-file' '--config=/plugin/bunfig.toml' '/plugin/dist/cli.js' restore`,
    );
    // A launcher of the person's own, put back by the restore: the plain command works.
    mkdirSync(paths.binDir, { recursive: true });
    writeFileSync(join(paths.binDir, "cc-smart-dev-kit"), "#!/bin/sh\n");
    expect(stageOneDone(paths, "/plugin/dist/cli.js")).toBe(
      "Restart every running Claude session (they still use the router), then run `cc-smart-dev-kit restore` again to stop and remove the router.",
    );
  });

  // Rewritten on purpose (it was "restore stops the router (after a yes), then removes the
  // copy, the unit and the env keys"): stopping the router while sessions still point at it
  // made every one of them fail. Now the first restore leaves the router running.
  test("stage 1 takes the env keys out and leaves the router for the running sessions; stage 2 stops and removes it", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

    const before = m.calls();
    const first = await m.run(["restore"]);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    const lines = first.stdout.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(STAGE_1_KEYS);
    expect(lines[1]).toStartWith(
      "  (its state before this restore: ~/.claude/cc-smart-dev-kit/backups/",
    );
    expect(lines[2]).toBe(STAGE_1_AGAIN);
    expect(lines[3]).toBe("");
    // The router keeps running: nothing was stopped, nothing asked of systemd.
    expect(m.calls().slice(before.length)).toBe("");
    expect(existsSync(m.paths.copy)).toBe(true);
    expect(existsSync(m.paths.unit)).toBe(true);
    // `env` went with its last key: the settings file before the gateway was set up.
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus" });

    // Stage 2: no gateway key left. Stopping a running router still asks first.
    const refused = await m.run(["restore"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe(
      [
        "cc-smart-dev-kit-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.",
        "Nothing was changed. Run again with --yes to stop it: cc-smart-dev-kit restore --yes",
        "",
      ].join("\n"),
    );
    expect(existsSync(m.paths.copy)).toBe(true);

    // A setup that did not finish has nothing left to finish once the router is gone.
    const marker = join(m.configDir, "cc-smart-dev-kit", "restart-pending");
    writeFileSync(marker, "pending\n");
    // Nor does the router's limit state: stage 2 removes it.
    const limitState = join(m.home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json");
    mkdirSync(dirname(limitState), { recursive: true });
    writeFileSync(limitState, '{"fallbacks":{},"limits":{},"version":1}\n');
    // Reworked: in this process (`runHere`), because the stop now asks the router's port
    // until it closes, and the fake server of this test cannot close for a subprocess.
    // It was `disable --now`, which waits for the router's whole drain (up to 120 s).
    const middle = m.calls();
    const done = await m.runHere(["restore", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(limitState)).toBe(false);
    expect(done.stdout).toContain(
      "- ~/.local/state/cc-smart-dev-kit/gateway-state.json: removed (the router's limit state)\n",
    );
    expect(m.calls().slice(middle.length)).toBe(
      [
        "--user is-active --quiet cc-smart-dev-kit-router.service",
        // Changed on purpose: the stop asks the unit's state, to wait only for its own port.
        "--user is-active cc-smart-dev-kit-router.service",
        "--user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user stop --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    // The config's port was asked once the stop was sent, and it was closed.
    expect(m.probed).toEqual([`http://127.0.0.1:${server.port}/__cc-smart-dev-kit/health`]);
    expect(done.stdout).toContain(
      `- cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket: disabled and stopped (port ${server.port} closed; answers in flight finish in the background)\n`,
    );
    expect(done.stdout).toContain(
      "- ~/.local/share/cc-smart-dev-kit/router.js: removed (cc-smart-dev-kit had created it)\n",
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(existsSync(m.paths.socket)).toBe(false);
    // The config holds the person's key: restore leaves it.
    expect(existsSync(m.paths.config)).toBe(true);
    // A third restore has nothing left to do.
    expect((await m.run(["restore"])).stdout).toBe(
      "Nothing to restore: cc-smart-dev-kit has nothing in any file.\n",
    );
  });

  test("a key the person changed after setup is theirs: restore leaves it, and the two stages still finish", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

    // The person points Claude Code at their own gateway by hand. That key is theirs from
    // now on; `ownedGatewayEnvKeys` drops it from the keys that still hold our value.
    const settings = JSON.parse(readFileSync(m.paths.settings, "utf8")) as {
      env: Record<string, string>;
      model: string;
    };
    settings.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:19999";
    writeFileSync(m.paths.settings, `${JSON.stringify(settings, null, 2)}\n`);

    // Stage 1: our keys go, the person's one stays, and running sessions still get their
    // warning to restart.
    const first = await m.run(["restore"]);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain(
      "~ ~/.claude/settings.json: removed env.ENABLE_TOOL_SEARCH; everything else kept\n",
    );
    expect(first.stdout).toContain(`${STAGE_1_AGAIN}\n`);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:19999" },
      model: "opus",
    });

    // Stage 2: no key that still holds our value is left, so the router goes; the person's
    // key stays, because it was never cc-smart-dev-kit's to remove. (The router keeps running until
    // the sessions restart: the first `restore` above said so.)
    const done = await m.runHere(["restore", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:19999" },
      model: "opus",
    });
  });

  test("--now does both at once, after the warning that every running session fails", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);
    const settings = readFileSync(m.paths.settings, "utf8");

    const refused = await m.run(["restore", "--now"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe(
      [
        "restore --now stops cc-smart-dev-kit-router while Claude sessions still use it: every running Claude session fails until it restarts.",
        "Nothing was changed. Run again with --yes to do it now: cc-smart-dev-kit restore --now --yes",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.settings, "utf8")).toBe(settings);

    // Reworked: in this process (`runHere`), for the port wait (see the test above). The
    // stop was `disable --now`, which blocked while the router drained.
    const before = m.calls();
    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toStartWith(
      `restore --now stops cc-smart-dev-kit-router while Claude sessions still use it: every running Claude session fails until it restarts.\n- cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket: disabled and stopped (port ${server.port} closed; answers in flight finish in the background)\n`,
    );
    expect(done.stdout).toContain(`${STAGE_1_KEYS}\n`);
    // The warning above is the question: no `is-active --quiet` first. Changed on purpose:
    // the stop asks the unit's state (no --quiet), to wait only for its own port.
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user is-active cc-smart-dev-kit-router.service",
        "--user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user stop --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(m.probed).toEqual([`http://127.0.0.1:${server.port}/__cc-smart-dev-kit/health`]);
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    // `env` went with its last key: the settings file as it was before the gateway wrote there.
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus" });
  });

  test("a port still held 15 s after the stop: restore fails clearly and restores nothing else", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);
    const settings = readFileSync(m.paths.settings, "utf8");

    m.port.held = true;
    const started = m.clock.now;
    const failed = await m.runHere(["restore", "--now", "--yes"]);
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toBe(
      `cc-smart-dev-kit: cc-smart-dev-kit-router.service is disabled and was told to stop, but 127.0.0.1:${server.port} still takes connections after 15 s. Nothing else was restored. See why: systemctl --user status cc-smart-dev-kit-router (and ss -ltnp for another program on the port). Then run cc-smart-dev-kit restore again.\n`,
    );
    expect(m.clock.now - started).toBe(15_000);
    // Nothing else was restored: the env keys, the copy and the unit are all still there.
    expect(readFileSync(m.paths.settings, "utf8")).toBe(settings);
    expect(existsSync(m.paths.copy)).toBe(true);
    expect(existsSync(m.paths.unit)).toBe(true);

    // Once the port is free, restore finishes.
    m.port.held = false;
    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.exitCode).toBe(0);
    expect(existsSync(m.paths.copy)).toBe(false);
  });

  const NOW_WARNING =
    "restore --now stops cc-smart-dev-kit-router while Claude sessions still use it: every running Claude session fails until it restarts.";

  test("another program answers on the port (a 404, not a health answer): restore says so and finishes", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

    m.port.other = true;
    const started = m.clock.now;
    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toStartWith(
      [
        NOW_WARNING,
        `  port ${server.port} answers, but not as this router (HTTP 404); not waiting for it`,
        "- cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket: disabled and stopping",
        "",
      ].join("\n"),
    );
    expect(m.clock.now - started).toBe(0);
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
  });

  test("a unit that was not running while the port is taken (a router started by hand): restore says so and finishes", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

    // The unit crash-loops (it cannot bind), and a `gateway serve` in a terminal answers.
    writeFileSync(m.state, "activating\n");
    m.port.held = true;
    const started = m.clock.now;
    const before = m.calls();
    m.probed.length = 0;
    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toStartWith(
      [
        NOW_WARNING,
        `  cc-smart-dev-kit-router.service was not running (systemctl --user is-active: activating); not waiting for port ${server.port}`,
        "- cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket: disabled and stopped",
        "",
      ].join("\n"),
    );
    expect(m.clock.now - started).toBe(0);
    // The unit's state decided it: the port was not even asked.
    expect(m.probed).toEqual([]);
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user is-active cc-smart-dev-kit-router.service",
        "--user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user stop --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(existsSync(m.paths.copy)).toBe(false);
  });

  test("an unreadable gateway.json: restore says the port is unknown, sends the stop, and waits for nothing", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

    writeFileSync(m.paths.config, `{ "backends": { "omniroute": { "apiKey": "${PLANTED_KEY}"`, {
      mode: 0o600,
    });
    m.probed.length = 0;
    const before = m.calls();
    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toStartWith(
      [
        NOW_WARNING,
        `  cannot read the router's port (${m.paths.config} is not valid JSON. Fix it by hand.); not waiting for it`,
        "- cc-smart-dev-kit-router.service and cc-smart-dev-kit-router.socket: disabled and stopping",
        "",
      ].join("\n"),
    );
    expect(done.stdout).not.toContain(PLANTED_KEY);
    expect(m.probed).toEqual([]);
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user disable cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user stop --no-block cc-smart-dev-kit-router.socket cc-smart-dev-kit-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    // The config holds the person's key: restore leaves it, even broken.
    expect(existsSync(m.paths.config)).toBe(true);
  });
});

describe("cc-smart-dev-kit gateway on / off", () => {
  test("on sets the env keys as owned keys; off removes them again", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{\n  "model": "opus"\n}\n');
    const on = await m.run(["gateway", "on"]);
    expect(on.stderr).toBe("");
    expect(on.stdout).toBe(
      [
        '~ ~/.claude/settings.json: env.ENABLE_TOOL_SEARCH: (none) -> "true"',
        `~ ~/.claude/settings.json: env.ANTHROPIC_BASE_URL: (none) -> "http://127.0.0.1:${server.port}"`,
        "Done. The changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "Every Claude Code session on this machine, in every folder, uses the gateway from now on: each Claude model's work (background titles and summaries too) goes to the slot of its family when that slot has a chain, and to Anthropic unchanged when it has none.",
        "",
      ].join("\n"),
    );
    expect((await m.run(["gateway", "on"])).stdout).toBe(
      "Nothing to change: the gateway is already on.\n",
    );
    const off = await m.run(["gateway", "off"]);
    expect(off.stdout.split("\n").at(-2)).toBe(
      "Restart each Claude session: removing a setting needs a restart.",
    );
    // `env` went with its last key: the settings file as it was before the gateway wrote there.
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus" });
  });

  test("a gateway key someone else set stops on: ForeignKeyError, nothing written", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const settings = `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:19999" } }, null, 2)}\n`;
    writeFileSync(m.paths.settings, settings);
    const on = await m.run(["gateway", "on"]);
    expect(on.exitCode).toBe(1);
    expect(on.stderr).toBe(
      `cc-smart-dev-kit: ${m.paths.settings}: env.ANTHROPIC_BASE_URL is http://127.0.0.1:19999, set by someone else. cc-smart-dev-kit does not overwrite it. Remove it by hand if cc-smart-dev-kit should manage it.\n`,
    );
    expect(readFileSync(m.paths.settings, "utf8")).toBe(settings);
    expect(existsSync(join(m.home, ".claude", "cc-smart-dev-kit"))).toBe(false);
  });

  test("on refuses while the router does not answer: every request would fail", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    for (const s of servers.splice(0)) s.stop(true);
    const on = await m.run(["gateway", "on"]);
    expect(on.exitCode).toBe(1);
    expect(on.stderr).toStartWith(
      `cc-smart-dev-kit: the router does not answer on 127.0.0.1:${server.port} (`,
    );
    expect(existsSync(m.paths.settings)).toBe(false);
  });
});

describe("cc-smart-dev-kit doctor: the gateway", () => {
  test("set up and running: the unit, the copy, the health page, the backend, each slot's first target", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, { "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"] });
    await m.run(["gateway", "setup"]);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toEndWith(
      [
        "✓ the router service (cc-smart-dev-kit-router.service) is active",
        "✓ the router copy ~/.local/share/cc-smart-dev-kit/router.js is up to date",
        `✓ the router's socket (cc-smart-dev-kit-router.socket) holds 127.0.0.1:${server.port}`,
        `✓ the router answers on 127.0.0.1:${server.port}`,
        "· history: no requests logged yet, keeping 90 days in ~/.local/state/cc-smart-dev-kit/history.db",
        `✓ backend omniroute (http://127.0.0.1:${server.port}) answers`,
        "· slot cc-smart-dev-kit-scout: Custom, first target omniroute:m1 (fallback on, 1 more after it)",
        "· slot cc-smart-dev-kit-worker: Custom, first target claude-sonnet-5-5 (fallback on)",
        "· slot cc-smart-dev-kit-fable: Claude (fable goes to Anthropic as Claude Code sent it)",
        "· slot cc-smart-dev-kit-opus: Claude (opus goes to Anthropic as Claude Code sent it)",
        "· slot cc-smart-dev-kit-judge: Claude judges every check, alone (the worker chain has no affordable target to stand in)",
        "",
      ].join("\n"),
    );
  });

  test("stopped, an old copy, a refused key: one ✗ for each, saying what to run", async () => {
    const m = machine();
    const server = fakeServer({ modelsStatus: 401 });
    m.writeConfig(server.port);
    await m.run(["gateway", "setup"]);
    writeFileSync(m.state, "inactive\n");
    writeFileSync(m.paths.copy, "// an older router\n");
    const doctor = await m.run(["doctor"]);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.stdout).toContain(
      "✗ the router service (cc-smart-dev-kit-router.service) is inactive. Run: cc-smart-dev-kit gateway setup\n",
    );
    expect(doctor.stdout).toContain(
      "✗ the router copy ~/.local/share/cc-smart-dev-kit/router.js is not this plugin version's router. Run: cc-smart-dev-kit gateway setup\n",
    );
    expect(doctor.stdout).toContain(
      `✗ backend omniroute (http://127.0.0.1:${server.port}) answered HTTP 401; check its key\n`,
    );
  });

  // Reworked: doctor counts the gateway as installed only when the router copy or its
  // unit is there (a gateway.json alone is information), so setup runs first. The
  // assertion is kept.
  test("a config others can read: ✗ naming chmod 600", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    chmodSync(m.paths.config, 0o644);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toContain(
      `✗ gateway config: ${m.paths.config} can be read by other users (mode 644); it holds API keys. Run: chmod 600 ${m.paths.config}\n`,
    );
  });
});

describe("cc-smart-dev-kit doctor: a gateway that is not installed, or half", () => {
  test("gateway.json alone (restore keeps it): information, not a failure", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toContain(
      "· gateway.json kept (~/.config/cc-smart-dev-kit/gateway.json); the gateway is not installed. To use it: cc-smart-dev-kit gateway setup\n",
    );
    expect(doctor.stdout).not.toContain("router");
    expect(m.calls()).toBe("");
  });

  test("the restart-pending marker: ✗ whatever else is there", async () => {
    const m = machine();
    mkdirSync(join(m.configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(join(m.configDir, "cc-smart-dev-kit", "restart-pending"), "pending\n");
    const doctor = await m.run(["doctor"]);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.stdout).toContain(
      "✗ a gateway setup did not finish; run: cc-smart-dev-kit gateway setup\n· gateway: not set up (optional). To use it: cc-smart-dev-kit gateway setup\n",
    );
  });

  test("set up with no gateway.json: the router's default port, every slot off, as information", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    m.probed.length = 0;
    const checks = await gatewayChecks({
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      bundle: BUILT_ROUTER,
      runner: () => ({ exitCode: 0, output: "active\n" }),
      service: "systemd",
      fetch: m.probe.fetch,
    });
    expect(
      checks.map((check) => `${check.info ? "·" : check.ok ? "✓" : "✗"} ${check.text}`),
    ).toEqual([
      "✓ the router service (cc-smart-dev-kit-router.service) is active",
      "✓ the router copy ~/.local/share/cc-smart-dev-kit/router.js is up to date",
      "· no ~/.config/cc-smart-dev-kit/gateway.json yet: every slot is off, so every Claude model goes to Anthropic as Claude Code sent it, on your own login. To add a backend: cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file",
      "✓ the router's socket (cc-smart-dev-kit-router.socket) holds 127.0.0.1:20100",
      "✓ the router answers on 127.0.0.1:20100",
      "· history: no requests logged yet, keeping 90 days in ~/.local/state/cc-smart-dev-kit/history.db",
      "· slot cc-smart-dev-kit-scout: Claude (haiku goes to Anthropic as Claude Code sent it)",
      "· slot cc-smart-dev-kit-worker: Claude (sonnet goes to Anthropic as Claude Code sent it)",
      "· slot cc-smart-dev-kit-fable: Claude (fable goes to Anthropic as Claude Code sent it)",
      "· slot cc-smart-dev-kit-opus: Claude (opus goes to Anthropic as Claude Code sent it)",
      "· slot cc-smart-dev-kit-judge: Claude judges every check, alone (the worker chain has no affordable target to stand in)",
    ]);
    // Asked of the fake, never the network.
    expect(m.probed).toEqual(["http://127.0.0.1:20100/__cc-smart-dev-kit/health"]);
  });

  /**
   * The router's two lines when it does not answer, with a systemctl that answers per
   * command: the service's state, the socket's state, and the socket's `Result`.
   */
  async function notAnswering(units: { service: string; socket: string; result: string }) {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    const asked: string[] = [];
    const checks = await gatewayChecks({
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      bundle: BUILT_ROUTER,
      runner: (cmd) => {
        asked.push(cmd.slice(2).join(" "));
        if (cmd[2] === "show") return { exitCode: 0, output: `${units.result}\n` };
        const word = cmd.at(-1)?.endsWith(".socket") ? units.socket : units.service;
        return { exitCode: word === "active" ? 0 : 3, output: `${word}\n` };
      },
      service: "systemd",
      // An open socket with no router holds the connection: no answer in time.
      fetch: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    const lines = checks.map((check) => `${check.info ? "·" : check.ok ? "✓" : "✗"} ${check.text}`);
    return { asked, lines };
  }

  test("the socket open and its router not answering (a crash loop): ✗ says requests wait, names the router's log", async () => {
    const { lines } = await notAnswering({
      result: "success",
      service: "activating",
      socket: "active",
    });
    expect(lines.slice(3, 5)).toEqual([
      "✓ the router's socket (cc-smart-dev-kit-router.socket) holds 127.0.0.1:20100",
      "✗ the socket holds 127.0.0.1:20100, but the router does not answer (The operation timed out.): every request waits in the socket and gets no answer. See why: journalctl --user -u cc-smart-dev-kit-router -n 30. Then: cc-smart-dev-kit gateway setup",
    ]);
  });

  test("the socket closed by systemd after the router's start limit: ✗ says every request is refused, names the router's log", async () => {
    const { asked, lines } = await notAnswering({
      result: "service-start-limit-hit",
      service: "failed",
      socket: "failed",
    });
    expect(asked).toContain("show -p Result --value cc-smart-dev-kit-router.socket");
    expect(lines.slice(3, 5)).toEqual([
      "✗ the router's socket (cc-smart-dev-kit-router.socket) is failed. Run: cc-smart-dev-kit gateway setup",
      "✗ the router failed to start again and again, so systemd closed its socket: every request to 127.0.0.1:20100 is refused (The operation timed out.). See why: journalctl --user -u cc-smart-dev-kit-router -n 30. Then: cc-smart-dev-kit gateway setup",
    ]);
  });

  test("a socket stopped for another reason: the plain line", async () => {
    const { lines } = await notAnswering({
      result: "success",
      service: "inactive",
      socket: "inactive",
    });
    expect(lines[4]).toBe(
      "✗ the router does not answer on 127.0.0.1:20100 (The operation timed out.)",
    );
  });
});

describe("cc-smart-dev-kit gateway slot: the file", () => {
  test("a field this version does not know survives a slot change; the file stays mode 600", async () => {
    const m = machine();
    const server = fakeServer();
    mkdirSync(dirname(m.paths.config), { recursive: true });
    writeFileSync(
      m.paths.config,
      JSON.stringify({
        backends: {
          omniroute: {
            apiKey: PLANTED_KEY,
            baseUrl: `http://127.0.0.1:${server.port}`,
            note: "kept by hand",
          },
        },
        futureField: { level: 3 },
        port: server.port,
        slots: { "cc-smart-dev-kit-scout": ["omniroute:m1", "claude-sonnet-5-5"] },
        timeouts: { firstByteMs: 5000, idleMs: 9000 },
        version: 1,
      }),
      { mode: 0o600 },
    );
    const slot = await m.run(["gateway", "slot", "worker", "claude-sonnet-5-5"]);
    expect(slot.stderr).toBe("");
    expect(slot.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(m.paths.config, "utf8"))).toEqual({
      aliases: {},
      anthropicBaseUrl: "https://api.anthropic.com",
      backends: {
        omniroute: {
          apiKey: PLANTED_KEY,
          baseUrl: `http://127.0.0.1:${server.port}`,
          note: "kept by hand",
        },
      },
      futureField: { level: 3 },
      port: server.port,
      slots: {
        "cc-smart-dev-kit-scout": ["omniroute:m1", "claude-sonnet-5-5"],
        "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
      },
      timeouts: { firstByteMs: 5000, idleMs: 9000 },
      version: 1,
    });
    expect(statSync(m.paths.config).mode & 0o777).toBe(0o600);
    // It saved under the lock (which made the state folder), and let it go.
    expect(existsSync(join(m.configDir, "cc-smart-dev-kit"))).toBe(true);
    expect(existsSync(join(m.configDir, "cc-smart-dev-kit", "lock"))).toBe(false);
  });
});

describe("cc-smart-dev-kit gateway slot judge: never set untested", () => {
  test("a target that lets the force push run is refused; nothing is saved", async () => {
    const m = machine();
    const server = fakeServer({ judge: { m1: "block", m2: "allow" } });
    m.writeConfig(server.port);
    const before = readFileSync(m.paths.config, "utf8");
    const refused = await m.run(["gateway", "slot", "judge", "omniroute:m1,omniroute:m2"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe(
      'judge test: omniroute:m1 blocked "git push --force origin main"\n',
    );
    expect(refused.stderr).toBe(
      "cc-smart-dev-kit: omniroute:m2 did not block the test check (git push --force origin main): let it run. The judge was not set.\n",
    );
    expect(readFileSync(m.paths.config, "utf8")).toBe(before);
    // Each target got the check-shaped test, on the backend's own key.
    expect(server.judged.map((call) => call.model)).toEqual(["m1", "m2"]);
    expect(server.judged.map((call) => call.key)).toEqual([
      `Bearer ${PLANTED_KEY}`,
      `Bearer ${PLANTED_KEY}`,
    ]);
    expect(JSON.stringify(server.judged[0]?.body.system)).toContain(
      "You are a security monitor for autonomous AI coding agents",
    );
  });

  test("a target that does not answer the test is refused too", async () => {
    const m = machine();
    const server = fakeServer({ judge: { m1: "block" } });
    m.writeConfig(server.port);
    const refused = await m.run(["gateway", "slot", "judge", "omniroute:m2"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toBe(
      "cc-smart-dev-kit: omniroute:m2 did not block the test check (git push --force origin main): HTTP 404. The judge was not set.\n",
    );
    expect(JSON.parse(readFileSync(m.paths.config, "utf8")).slots).not.toHaveProperty(
      "cc-smart-dev-kit-judge",
    );
  });

  test("targets that all block it are set", async () => {
    const m = machine();
    const server = fakeServer({ judge: { m1: "block", m2: "block" } });
    m.writeConfig(server.port);
    const set = await m.run(["gateway", "slot", "judge", "omniroute:m2,omniroute:m1"]);
    expect(set.stderr).toBe("");
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe(
      [
        'judge test: omniroute:m2 blocked "git push --force origin main"',
        'judge test: omniroute:m1 blocked "git push --force origin main"',
        "cc-smart-dev-kit-judge: (new)",
        "  now: omniroute:m2 → omniroute:m1  (fallback on)",
        "WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
        "The router uses it from its next request.",
        "",
      ].join("\n"),
    );
    const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(saved.slots["cc-smart-dev-kit-judge"]).toEqual(["omniroute:m2", "omniroute:m1"]);
    // The proof the router checks: the recipe in config.ts's `judgeTestProof`, by hand. Test
    // version 3 since 0.5.0, when a judge started judging every check first.
    const url = `http://127.0.0.1:${server.port}`;
    const proof = (target: string) =>
      createHash("sha256")
        .update(`cc-smart-dev-kit judge test 3\n${target}\n${url}`)
        .digest("hex")
        .slice(0, 32);
    expect(saved.judgeTested).toEqual({
      "omniroute:m1": proof("omniroute:m1"),
      "omniroute:m2": proof("omniroute:m2"),
    });
    // `judge off` drops the slot, its proofs, and its fallback record in the state file.
    const statePath = join(m.home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json");
    mkdirSync(dirname(statePath), { recursive: true });
    const record = { lastAt: 1, model: "claude-sonnet-5", resetsAt: null, since: 1, target: "x" };
    writeFileSync(
      statePath,
      JSON.stringify({
        fallbacks: { "cc-smart-dev-kit-judge": record, "cc-smart-dev-kit-opus": record },
        limits: {},
        version: 1,
      }),
    );
    expect((await m.run(["gateway", "slot", "judge", "off"])).exitCode).toBe(0);
    const after = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(after.slots).not.toHaveProperty("cc-smart-dev-kit-judge");
    expect(after).not.toHaveProperty("judgeTested");
    expect(JSON.parse(readFileSync(statePath, "utf8")).fallbacks).toEqual({
      "cc-smart-dev-kit-opus": record,
    });
  });

  test("a judge target set by hand, or by a config from before 0.3, is untested: doctor fails", async () => {
    const m = machine();
    const server = fakeServer();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    mkdirSync(dirname(m.paths.config), { recursive: true });
    writeFileSync(
      m.paths.config,
      JSON.stringify({
        backends: {
          omniroute: { apiKey: PLANTED_KEY, baseUrl: `http://127.0.0.1:${server.port}` },
        },
        // A proof for another target does not count for this one.
        judgeTested: { "omniroute:m2": "0".repeat(32) },
        port: server.port,
        slots: {
          "cc-smart-dev-kit-judge": ["omniroute:m1"],
          "cc-smart-dev-kit-scout": ["claude-sonnet-5-5"],
          "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
        },
        version: 1,
      }),
      { mode: 0o600 },
    );
    const checks = await gatewayChecks({
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      bundle: BUILT_ROUTER,
      runner: () => ({ exitCode: 0, output: "active\n" }),
      service: "systemd",
      fetch: m.probe.fetch,
    });
    expect(checks.at(-1)).toEqual({
      ok: false,
      text: "slot cc-smart-dev-kit-judge: omniroute:m1 has not passed the judge test, so the router ignores it. Run: cc-smart-dev-kit gateway slot judge omniroute:m1",
    });
  });

  test("a scout or worker chain that names Opus or Fable: ! a warning, never a failure", async () => {
    const m = machine();
    const server = fakeServer();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    mkdirSync(dirname(m.paths.config), { recursive: true });
    writeFileSync(
      m.paths.config,
      JSON.stringify({
        backends: {
          omniroute: { apiKey: PLANTED_KEY, baseUrl: `http://127.0.0.1:${server.port}` },
        },
        modelSlots: { "claude-opus-5-5": "cc-smart-dev-kit-opus" },
        port: server.port,
        slots: {
          "cc-smart-dev-kit-opus": ["claude-opus-5-5", "omniroute:m1"],
          "cc-smart-dev-kit-scout": ["omniroute:m1", "claude-fable-5-1"],
          "cc-smart-dev-kit-worker": ["omniroute:m1", "claude-sonnet-5-5"],
        },
        version: 1,
      }),
      { mode: 0o600 },
    );
    const checks = await gatewayChecks({
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      bundle: BUILT_ROUTER,
      runner: () => ({ exitCode: 0, output: "active\n" }),
      service: "systemd",
      fetch: m.probe.fetch,
    });
    const warnings = checks.filter((check) => check.warn === true);
    expect(warnings.map((check) => check.text)).toEqual([
      "slot cc-smart-dev-kit-scout names claude-fable-5-1: a slot for routine work that answers on Claude Opus or Fable spends your own plan usage. To change it: cc-smart-dev-kit gateway slot cc-smart-dev-kit-scout <targets>",
    ]);
    // A warning is not a failure, and the model slot is left alone (a premium model is its job).
    expect(warnings.every((check) => check.ok)).toBe(true);
    expect(checks.some((check) => check.text.includes("cc-smart-dev-kit-opus names"))).toBe(false);
    expect(checks.some((check) => check.text.includes("cc-smart-dev-kit-worker names"))).toBe(
      false,
    );
  });

  test("slot opus: one backend target is a chain; off again; no model id is written for it", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const on = await m.run(["gateway", "slot", "opus", "omniroute:ollama-cloud/glm-5.3-flash"]);
    expect(on.stderr).toBe("");
    expect(on.exitCode).toBe(0);
    expect(on.stdout).toBe(
      "cc-smart-dev-kit-opus: (new)\n  now: omniroute:ollama-cloud/glm-5.3-flash  (fallback off)\nThe router uses it from its next request.\n",
    );
    const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(saved).not.toHaveProperty("modelSlots");
    expect(saved.slots["cc-smart-dev-kit-opus"]).toEqual(["omniroute:ollama-cloud/glm-5.3-flash"]);
    const off = await m.run(["gateway", "slot", "opus", "off"]);
    expect(off.stdout).toBe(
      [
        "cc-smart-dev-kit-opus: omniroute:ollama-cloud/glm-5.3-flash",
        "  now: Claude: opus goes to Anthropic as Claude Code sent it, on your own login",
        "  saved, not in use: omniroute:ollama-cloud/glm-5.3-flash  (fallback off; to use it: cc-smart-dev-kit gateway slot opus custom)",
        "The router uses it from its next request.",
        "",
      ].join("\n"),
    );
    // The chain is not forgotten: it waits in `kept` for `slot opus custom`.
    const offConfig = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(offConfig.slots).not.toHaveProperty("cc-smart-dev-kit-opus");
    expect(offConfig.kept).toEqual({
      "cc-smart-dev-kit-opus": { targets: ["omniroute:ollama-cloud/glm-5.3-flash"] },
    });
  });

  test("slot claude keeps the chain, custom uses it again with its switch, clear deletes it", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, { "cc-smart-dev-kit-worker": ["omniroute:m1", "omniroute:m2"] });
    // A switch the person set: it must travel with the chain, both ways.
    expect((await m.run(["gateway", "fallback", "worker", "off"])).exitCode).toBe(0);
    // Custom to Claude: the chain and its fallback switch wait in `kept`.
    const claude = await m.run(["gateway", "slot", "worker", "claude"]);
    expect(claude.stderr).toBe("");
    expect(claude.exitCode).toBe(0);
    expect(claude.stdout).toContain(
      [
        "cc-smart-dev-kit-worker: omniroute:m1 → omniroute:m2",
        "  now: Claude: sonnet goes to Anthropic as Claude Code sent it, on your own login",
        "  saved, not in use: omniroute:m1 → omniroute:m2  (fallback off; to use it: cc-smart-dev-kit gateway slot worker custom)",
      ].join("\n"),
    );
    const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(saved.slots).not.toHaveProperty("cc-smart-dev-kit-worker");
    expect(saved.kept).toEqual({
      "cc-smart-dev-kit-worker": {
        fallback: false,
        targets: ["omniroute:m1", "omniroute:m2"],
      },
    });
    // The switch moved with the chain: `fallback` names no slot without one.
    expect(saved).not.toHaveProperty("fallback");
    // Status and doctor say it is Claude, with the chain saved and not in use.
    const status = await m.run(["gateway", "status"]);
    expect(status.stdout).toContain(
      [
        "  cc-smart-dev-kit-worker Claude: sonnet goes to Anthropic as Claude Code sent it, on your own login",
        "    saved, not in use: omniroute:m1 → omniroute:m2  (fallback off; to use it: cc-smart-dev-kit gateway slot worker custom)",
      ].join("\n"),
    );
    // Custom: the chain back, with the fallback switch it was saved with.
    const custom = await m.run(["gateway", "slot", "worker", "custom"]);
    expect(custom.stderr).toBe("");
    expect(custom.exitCode).toBe(0);
    expect(custom.stdout).toContain(
      [
        "cc-smart-dev-kit-worker: Claude",
        "  now: omniroute:m1 → omniroute:m2  (fallback off: only omniroute:m1 answers; the rest are kept, not used)",
      ].join("\n"),
    );
    const back = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(back.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1", "omniroute:m2"]);
    expect(back).not.toHaveProperty("kept");
    expect(back.fallback).toEqual({ "cc-smart-dev-kit-worker": false });
    // Clear: the chain is gone, in use, and there is nothing left to use again.
    expect((await m.run(["gateway", "slot", "worker", "clear"])).exitCode).toBe(0);
    const cleared = JSON.parse(readFileSync(m.paths.config, "utf8"));
    expect(cleared.slots).not.toHaveProperty("cc-smart-dev-kit-worker");
    expect(cleared).not.toHaveProperty("kept");
    const again = await m.run(["gateway", "slot", "worker", "clear"]);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toBe("cc-smart-dev-kit: cc-smart-dev-kit-worker has no chain to clear\n");
    // And custom with nothing saved is refused, saying what to do.
    const nothing = await m.run(["gateway", "slot", "worker", "custom"]);
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stderr).toBe(
      "cc-smart-dev-kit: cc-smart-dev-kit-worker has no saved chain, so it stays Claude. Give it one: cc-smart-dev-kit gateway slot worker <targets>\n",
    );
  });

  test("slot fable with two backends, then fallback on: the switch is saved and said; a slot with no chain is refused", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const set = await m.run(["gateway", "slot", "fable", "omniroute:m1,omniroute:m2"]);
    expect(set.stderr).toBe("");
    expect(set.stdout).toBe(
      [
        "cc-smart-dev-kit-fable: (new)",
        "  now: omniroute:m1 → omniroute:m2  (fallback off: only omniroute:m1 answers; the rest are kept, not used)",
        "  To let the next target answer when omniroute:m1 fails or rests: cc-smart-dev-kit gateway fallback fable on",
        "The router uses it from its next request.",
        "",
      ].join("\n"),
    );
    const on = await m.run(["gateway", "fallback", "fable", "on"]);
    expect(on.stderr).toBe("");
    expect(on.stdout).toBe(
      [
        "cc-smart-dev-kit-fable: fallback off → on",
        "  omniroute:m1 → omniroute:m2  (fallback on)",
        "  The next target answers when the one before it fails or rests.",
        "The router uses it from its next request.",
        "",
      ].join("\n"),
    );
    expect(JSON.parse(readFileSync(m.paths.config, "utf8")).fallback).toEqual({
      "cc-smart-dev-kit-fable": true,
    });
    const refused = await m.run(["gateway", "fallback", "opus", "on"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toBe(
      "cc-smart-dev-kit: cc-smart-dev-kit-opus has no chain, so it has nothing to fall back to. Give it one first: cc-smart-dev-kit gateway slot opus <targets>\n",
    );
    expect((await m.run(["gateway", "fallback", "fable"])).exitCode).toBe(2);
  });

  test("status shows each slot's chain and its fallback switch, and every slot that is off", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, {
      "cc-smart-dev-kit-opus": ["omniroute:m1", "omniroute:m2"],
      "cc-smart-dev-kit-worker": ["omniroute:m1", "omniroute:m2"],
    });
    const status = await m.run(["gateway", "status"]);
    expect(status.stderr).toBe("");
    expect(status.stdout).toContain(
      [
        "Slots (Claude: plain Claude; Custom: the first target answers, the next one only while fallback is on):",
        "  cc-smart-dev-kit-scout Custom: omniroute:m1 → claude-sonnet-5-5  (fallback on; breaker on)",
        "  cc-smart-dev-kit-worker Custom: omniroute:m1 → omniroute:m2  (fallback on; breaker on)",
        "  cc-smart-dev-kit-fable Claude: fable goes to Anthropic as Claude Code sent it, on your own login",
        "  cc-smart-dev-kit-opus Custom: omniroute:m1 → omniroute:m2  (fallback off: only omniroute:m1 answers; the rest are kept, not used; breaker on)",
        "  cc-smart-dev-kit-judge Claude: Claude judges every check, alone: no worker target has passed the judge test yet (omniroute:m1, omniroute:m2; cc-smart-dev-kit gateway setup tests them)",
        "",
      ].join("\n"),
    );
  });
});

describe("status names an open breaker", () => {
  test("one line per slot whose every target is limited or down, with each target's rest", async () => {
    const m = machine();
    const at = Date.UTC(2026, 9, 15, 10, 0, 0);
    const server = fakeServer({
      breakers: {
        "cc-smart-dev-kit-worker": {
          held: 4,
          heldNow: 2,
          since: at,
          targets: [
            { status: 429, target: "omniroute:m1", until: at + 60_000 },
            { status: null, target: "omniroute:m2", until: at + 30_000 },
          ],
        },
      },
    });
    m.writeConfig(server.port, { "cc-smart-dev-kit-worker": ["omniroute:m1", "omniroute:m2"] });
    const status = await m.run(["gateway", "status"]);
    expect(status.stderr).toBe("");
    const line = status.stdout.split("\n").find((text) => text.includes("all targets limited"));
    expect(line).toMatch(
      /^ {2}cc-smart-dev-kit-worker: all targets limited, holding requests since (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d \(omniroute:m1 429 until (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d; omniroute:m2 no answer until (?:[A-Z][a-z]{2} \d{1,2} )?\d\d:\d\d\)$/,
    );
  });
});

describe("cc-smart-dev-kit gateway history", () => {
  /** A row with the values the test's assertions name. */
  function seededRow(at: number, overrides: Record<string, unknown> = {}) {
    return {
      at,
      breaker: null,
      cost: { estimated: true, usd: 0.001 },
      model: "claude-sonnet-5-5",
      ms: 100,
      nextTarget: null,
      session: "session-1",
      slot: "cc-smart-dev-kit-worker",
      status: 200,
      target: "claude-sonnet-5-5",
      tokens: { cacheRead: 1000, cacheWrite: 20, input: 100, output: 10 },
      ...overrides,
    };
  }

  test("no database yet: it says the router makes the file with its first row", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const history = await m.run(["gateway", "history"]);
    expect(history.stderr).toBe("");
    expect(history.exitCode).toBe(0);
    expect(history.stdout).toBe(
      "No request logged yet: ~/.local/state/cc-smart-dev-kit/history.db is made by the router's first row.\n",
    );
  });

  test("history.retentionDays: 0 says the log is off, and reads nothing", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, {}, { history: { retentionDays: 0 } });
    const history = await m.run(["gateway", "history"]);
    expect(history.exitCode).toBe(0);
    expect(history.stdout).toBe(
      "The request history is off (history.retentionDays: 0 in ~/.config/cc-smart-dev-kit/gateway.json): nothing is logged.\n",
    );
    // `gateway status` says the same, and never a failure.
    const status = await m.run(["gateway", "status"]);
    expect(status.stdout).toContain(
      "history: off (history.retentionDays: 0) in ~/.local/state/cc-smart-dev-kit/history.db\n",
    );
  });

  test("the table: each target's requests, errors, tokens, cost and worst p95, in the range", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const now = Date.now(); // the CLI reads "now" itself, so the rows are recent
    const writer = createHistoryWriter({
      file: m.paths.history,
      flushAfterMs: 60_000,
      log: () => {},
      retentionDays: () => 90,
    });
    writer.record(seededRow(now - 5 * 60_000));
    writer.record(
      seededRow(now - 4 * 60_000, {
        cost: null,
        ms: 300,
        status: 500,
        tokens: null,
      }),
    );
    writer.flush();
    writer.close();

    const history = await m.run(["gateway", "history", "1h", "--by", "target"]);
    expect(history.stderr).toBe("");
    expect(history.exitCode).toBe(0);
    expect(history.stdout).toContain(
      "History, last 1h (1-minute buckets), by target. Cost is estimated: Claude at its list price, a backend at the price its own list gives.\n",
    );
    // One target, two rows: 100 and 300 ms, one error, the tokens and the cost summed.
    expect(history.stdout).toMatch(
      /claude-sonnet-5-5 {2,}2 +1 +100 +10 +1,000 +20 +\$0\.001 +300 ms/,
    );
    // A filter narrows it: --errors leaves only the 500.
    const errors = await m.run(["gateway", "history", "1h", "--errors"]);
    expect(errors.stdout).toMatch(/claude-sonnet-5-5 {2,}1 +1 +0 +0 +0 +0 +\$0 +300 ms/);
    // `gateway status` shows the database's size and the retention (D51).
    const status = await m.run(["gateway", "status"]);
    expect(status.stdout).toMatch(
      /history: [\d.]+ (?:B|KB|MB), keeping 90 days in ~\/\.local\/state\/cc-smart-dev-kit\/history\.db/,
    );
  });

  test("a wrong range, --by value or filter is a usage error", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    for (const args of [
      ["gateway", "history", "2h"],
      ["gateway", "history", "--by", "provider"],
      ["gateway", "history", "--slot"],
      ["gateway", "history", "1h", "7d"],
    ]) {
      const result = await m.run(args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toStartWith("Usage: cc-smart-dev-kit gateway <command>");
    }
  });
});

describe("cc-smart-dev-kit gateway breaker", () => {
  /**
   * Each test here starts the CLI as a real process, up to seven times. Bun's 5 s default is too
   * short on a loaded machine; a speed limit, not a race, and no assertion depends on it.
   */
  const SPAWNING_TEST_MS = 30_000;

  /** A config on the fake server's port: a worker chain of two, and fields this version keeps. */
  function twoTargetMachine() {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, { "cc-smart-dev-kit-worker": ["omniroute:m1", "omniroute:m2"] });
    m.useServer(server.port, {
      futureField: { level: 3 },
      timeouts: { breakerHoldMs: 90_000, firstByteMs: 5000, idleMs: 9000 },
    });
    return { m, server };
  }

  test(
    "worker off, then on: the switch is saved and said, and the file keeps its other fields",
    async () => {
      const { m } = twoTargetMachine();
      const off = await m.run(["gateway", "breaker", "worker", "off"]);
      expect(off.stderr).toBe("");
      expect(off.exitCode).toBe(0);
      expect(off.stdout).toBe(
        [
          "cc-smart-dev-kit-worker: breaker on → off",
          "  omniroute:m1 → omniroute:m2  (breaker off)",
          "  While every target is limited or down, the last answer goes back to Claude Code at once.",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
      expect(saved.breaker).toEqual({ "cc-smart-dev-kit-worker": false });
      // Everything else the file held is still there, the hold included, and the mode is 600.
      expect(saved.futureField).toEqual({ level: 3 });
      expect(saved.timeouts).toEqual({ breakerHoldMs: 90_000, firstByteMs: 5000, idleMs: 9000 });
      expect(saved.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1", "omniroute:m2"]);
      expect(statSync(m.paths.config).mode & 0o777).toBe(0o600);
      // It saved under the lock and let it go.
      expect(existsSync(join(m.configDir, "cc-smart-dev-kit", "lock"))).toBe(false);

      const on = await m.run(["gateway", "breaker", "worker", "on"]);
      expect(on.stderr).toBe("");
      expect(on.stdout).toBe(
        [
          "cc-smart-dev-kit-worker: breaker off → on",
          "  omniroute:m1 → omniroute:m2  (breaker on)",
          "  While every target is limited or down, the request waits a little and then Claude Code is asked to retry.",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      // On is the default: no entry, and no empty field either.
      expect(JSON.parse(readFileSync(m.paths.config, "utf8"))).not.toHaveProperty("breaker");
    },
    SPAWNING_TEST_MS,
  );

  test(
    "status shows the breaker switch beside the fallback switch, never one for the judge",
    async () => {
      const { m } = twoTargetMachine();
      await m.run(["gateway", "breaker", "worker", "off"]);
      const status = await m.run(["gateway", "status"]);
      expect(status.stderr).toBe("");
      expect(status.stdout).toContain(
        [
          "  cc-smart-dev-kit-scout Custom: omniroute:m1 → claude-sonnet-5-5  (fallback on; breaker on)",
          "  cc-smart-dev-kit-worker Custom: omniroute:m1 → omniroute:m2  (fallback on; breaker off)",
          "  cc-smart-dev-kit-fable Claude: fable goes to Anthropic as Claude Code sent it, on your own login",
          "  cc-smart-dev-kit-opus Claude: opus goes to Anthropic as Claude Code sent it, on your own login",
          "  cc-smart-dev-kit-judge Claude: Claude judges every check, alone: no worker target has passed the judge test yet (omniroute:m1, omniroute:m2; cc-smart-dev-kit gateway setup tests them)",
          "",
        ].join("\n"),
      );
    },
    SPAWNING_TEST_MS,
  );

  test(
    "the judge, a slot with no chain, a wrong word and missing words are refused, and nothing is saved",
    async () => {
      const { m } = twoTargetMachine();
      const before = readFileSync(m.paths.config, "utf8");
      const judge = await m.run(["gateway", "breaker", "judge", "on"]);
      expect(judge.exitCode).toBe(1);
      expect(judge.stdout).toBe("");
      expect(judge.stderr).toBe(
        "cc-smart-dev-kit: cc-smart-dev-kit-judge: the judge never holds a request (a held safety check would freeze every action in auto mode), so it has no breaker switch\n",
      );
      const noChain = await m.run(["gateway", "breaker", "fable", "off"]);
      expect(noChain.exitCode).toBe(1);
      expect(noChain.stderr).toBe(
        "cc-smart-dev-kit: cc-smart-dev-kit-fable has no chain, so there is no request for the breaker to hold. Give it one first: cc-smart-dev-kit gateway slot fable <targets>\n",
      );
      const word = await m.run(["gateway", "breaker", "worker", "maybe"]);
      expect(word.exitCode).toBe(1);
      expect(word.stderr).toBe('cc-smart-dev-kit: say on or off, not "maybe"\n');
      const name = await m.run(["gateway", "breaker", "Worker!", "off"]);
      expect(name.exitCode).toBe(1);
      expect(name.stderr).toBe(
        'cc-smart-dev-kit: "Worker!" is not a slot name (scout, worker, opus, fable, or cc-smart-dev-kit-<name>)\n',
      );
      // Words missing or left over: the usage, exit 2.
      for (const args of [
        ["breaker"],
        ["breaker", "worker"],
        ["breaker", "worker", "on", "extra"],
      ]) {
        const usage = await m.run(["gateway", ...args]);
        expect(usage.exitCode).toBe(2);
        expect(usage.stderr).toContain(
          "  breaker <slot> on|off  When every target of a slot is limited or down",
        );
      }
      expect(readFileSync(m.paths.config, "utf8")).toBe(before);
    },
    SPAWNING_TEST_MS,
  );

  test(
    "a config the breaker's hold is too long for, or that is not JSON, stops the command and is left alone",
    async () => {
      const { m } = twoTargetMachine();
      const tooLong = JSON.stringify({
        ...JSON.parse(readFileSync(m.paths.config, "utf8")),
        timeouts: { breakerHoldMs: 300_000 },
      });
      writeFileSync(m.paths.config, tooLong, { mode: 0o600 });
      const refused = await m.run(["gateway", "breaker", "worker", "off"]);
      expect(refused.exitCode).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain(`${m.paths.config} is not a valid gateway config:`);
      expect(refused.stderr).toContain(
        "too long: at most 240000 ms (240 s), because a longer hold risks Claude Code giving up on the request",
      );
      expect(refused.stderr).toContain("at timeouts.breakerHoldMs");
      expect(refused.stderr).not.toContain(PLANTED_KEY);
      expect(readFileSync(m.paths.config, "utf8")).toBe(tooLong);

      const broken = `{"backends":{"omniroute":{"apiKey":"${PLANTED_KEY}",}}}`;
      writeFileSync(m.paths.config, broken, { mode: 0o600 });
      const notJson = await m.run(["gateway", "breaker", "worker", "off"]);
      expect(notJson.exitCode).toBe(1);
      expect(notJson.stderr).toBe(
        `cc-smart-dev-kit: ${m.paths.config} is not valid JSON. Fix it by hand.\n`,
      );
      expect(readFileSync(m.paths.config, "utf8")).toBe(broken);
    },
    SPAWNING_TEST_MS,
  );

  test(
    "it is in the command's help",
    async () => {
      const { m } = twoTargetMachine();
      const help = await m.run(["gateway", "help"]);
      expect(help.stdout).toContain(
        [
          "  breaker <slot> on|off  When every target of a slot is limited or down, may the router hold",
          "                         the request for a while and then ask Claude Code to retry? Off: the",
          "                         last answer goes back at once. On by default for scout, worker,",
          "                         opus and fable. The judge never holds, so it has no switch.",
        ].join("\n"),
      );
    },
    SPAWNING_TEST_MS,
  );
});

describe("cc-smart-dev-kit gateway on: no gateway.json", () => {
  test("on uses the default port, after its health check, when there is no config", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    m.probed.length = 0;
    const on = await m.runHere(["gateway", "on"]);
    expect(on.stderr).toBe("");
    expect(on.exitCode).toBe(0);
    expect(m.probed).toEqual(["http://127.0.0.1:20100/__cc-smart-dev-kit/health"]);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(
      "http://127.0.0.1:20100",
    );
    // A router that does not answer still stops it, also on the default port.
    writeFileSync(m.state, "inactive\n");
    const off = await m.runHere(["gateway", "off"]);
    expect(off.exitCode).toBe(0);
    const refused = await m.runHere(["gateway", "on"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toStartWith(
      "cc-smart-dev-kit: the router does not answer on 127.0.0.1:20100 (Unable to connect.",
    );
  });
});

describe("secrets", () => {
  test("no command ever prints the backend key, the broken config's text included", async () => {
    const m = machine();
    const server = fakeServer();
    const outputs: string[] = [];
    const record = <T extends { stdout: string; stderr: string }>(result: T): T => {
      outputs.push(result.stdout, result.stderr);
      return result;
    };
    // Reworked start: setup asks the config's port first, so the config names the fake
    // server's port before the first setup (it used to create the config on the default
    // port). Planted too: a backend whose base URL carries a user and a password.
    m.writeConfig(server.port);
    m.useServer(server.port, {
      backends: {
        creds: { apiKey: PLANTED_KEY, baseUrl: `http://user:SECRET-pass@127.0.0.1:${server.port}` },
        omniroute: { apiKey: PLANTED_KEY, baseUrl: `http://127.0.0.1:${server.port}` },
      },
    });
    record(await m.run(["gateway", "setup", "--backend-key-stdin", "omniroute"], PLANTED_KEY));
    record(await m.run(["gateway", "setup", "--backend-key-stdin", "creds"], PLANTED_KEY));
    record(await m.run(["gateway", "status"]));
    record(await m.run(["gateway", "models"]));
    record(await m.run(["gateway", "slot", "worker", "omniroute:m1,claude-sonnet-5-5"]));
    record(await m.run(["gateway", "slot", "judge", "omniroute:m2"]));
    record(await m.run(["gateway", "slot", "opus", "claude-opus-5-5,omniroute:m1"]));
    record(await m.run(["gateway", "fallback", "opus", "on"]));
    record(await m.run(["gateway", "fallback", "worker", "off"]));
    record(await m.run(["gateway", "breaker", "worker", "off"]));
    record(await m.run(["gateway", "breaker", "judge", "on"]));
    record(await m.run(["gateway", "fallback", "judge", "off"]));
    record(await m.run(["gateway", "slot", "judge", "claude-sonnet-5-5"]));
    record(await m.run(["gateway", "slot", "opus", "off"]));
    record(await m.run(["usage"]));
    record(await m.run(["gateway", "history"]));
    record(await m.run(["gateway", "slot", "worker", "omniroute:nope"]));
    record(await m.run(["gateway", "on"]));
    record(await m.run(["gateway", "status"]));
    record(await m.run(["gateway", "off"]));
    record(await m.run(["doctor"]));
    record(await m.run(["gateway", "help"]));
    record(await m.run(["gateway", "setup", "--backend-key-stdin"], PLANTED_KEY));
    // A broken file: the error must not quote the text around the mistake.
    writeFileSync(m.paths.config, `{"backends":{"omniroute":{"apiKey":"${PLANTED_KEY}",}}}`, {
      mode: 0o600,
    });
    // Not `status` from here on: without a good config it asks the default port, which may
    // belong to a router running on this machine.
    record(await m.run(["gateway", "models"]));
    record(await m.run(["gateway", "slot", "worker", "claude-sonnet-5-5"]));
    record(await m.run(["gateway", "breaker", "worker", "on"]));
    record(await m.run(["doctor"]));
    // Valid JSON that fails the schema: the error names fields, not values.
    writeFileSync(
      m.paths.config,
      JSON.stringify({
        backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: "ftp://x" } },
        slots: {},
        version: 1,
      }),
      { mode: 0o600 },
    );
    record(await m.run(["gateway", "models"]));
    record(await m.run(["doctor"]));
    const all = outputs.join("\n");

    // The backend did receive the key: the test would see a leak if one were printed.
    expect(server.seenKeys).toContain(`Bearer ${PLANTED_KEY}`);
    // The URL with the password was printed, masked, by status, models and doctor.
    const maskedUrl = `••••${String(server.port).slice(-4)}`;
    expect(all).toContain(`backend creds: ${maskedUrl} key ••••cdef → HTTP 200`);
    expect(all).toContain(`\ncreds  ${maskedUrl}  (key ••••cdef)`);
    expect(all).toContain(`✓ backend creds (${maskedUrl}) answers`);
    expect(all).toContain("••••cdef");
    expect(all).not.toContain(PLANTED_KEY);
    expect(all).not.toContain("SECRET");
  }, 60_000);
});

describe("the router copy runs on its own", () => {
  test("bun runs the copy with no plugin folder: it serves its health page on the config's port", async () => {
    const m = machine();
    const server = fakeServer();
    const port = server.port;
    m.writeConfig(port);
    // Reworked: the fake server stays up during setup, which asks the port before and
    // after the restart. Then it stops, and only lends its free port to the router.
    expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
    for (const s of servers.splice(0)) s.stop(true);
    const guard = subprocessGuard();
    const proc = Bun.spawn([process.execPath, ...guard.args, "--no-env-file", m.paths.copy], {
      env: { ...m.env, ...guard.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      // Ready once it says so: its first line.
      const reader = proc.stdout.getReader();
      let said = "";
      while (!said.includes("\n")) {
        const step = await reader.read();
        if (step.done) break;
        said += new TextDecoder().decode(step.value);
      }
      reader.releaseLock();
      expect(said).toBe(
        `cc-smart-dev-kit-router listening on http://127.0.0.1:${port} (config ${m.paths.config})\n`,
      );
      const response = await fetch(`http://127.0.0.1:${port}/__cc-smart-dev-kit/health`);
      expect(await response.json()).toMatchObject({ ok: true, port, requests: 0 });
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 20_000);
});

describe("cc-smart-dev-kit gateway on Windows: the router as a Scheduled Task", () => {
  test("setup writes the task's definition, registers it, and starts the router", async () => {
    const m = machine({ windows: true });
    const done = await m.runHere(["gateway", "setup", "--no-backend-key"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toBe(
      [
        "no config at ~/.config/cc-smart-dev-kit/gateway.json yet: every slot is off, so every Claude model goes to Anthropic as Claude Code sent it, on your own login, until the OmniRoute key is added (setup --backend-key-stdin omniroute)",
        "+ ~/.local/share/cc-smart-dev-kit/router.js: router copy created",
        "+ ~/.local/share/cc-smart-dev-kit/router-task.xml: task created",
        "registered and (re)started the task cc-smart-dev-kit-router",
        "Claude Code does not use the gateway yet. Check it: cc-smart-dev-kit gateway status. Then: cc-smart-dev-kit gateway on.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.copy).equals(readFileSync(BUILT_ROUTER))).toBe(true);
    // The definition runs the copy, at logon, as this person, without elevation.
    const definition = readFileSync(m.taskPath, "utf8");
    expect(definition).toContain("<UserId>MACHINE\\user</UserId>");
    expect(definition).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(definition).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(definition).toContain(`<Arguments>--no-env-file "${m.paths.copy}"</Arguments>`);
    expect(definition).toContain(`<Command>${process.execPath}</Command>`);
    // The read-only pass asks the task twice, the writing pass twice, then registers and starts.
    expect(m.taskCalls).toEqual(["query", "query", "query", "query", "register", "start"]);
    expect(m.task.registered).toBe(true);
    expect(m.task.state).toBe("Running");
    // Not one systemctl call: this machine has no units.
    expect(m.calls()).toBe("");
    expect(m.probed).toEqual([
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
      "http://127.0.0.1:20100/__cc-smart-dev-kit/health",
    ]);

    const again = await m.runHere(["gateway", "setup", "--no-backend-key"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("router already up to date (no restart)\n");
    // Two more passes: both ask the task's state, whether it runs what setup writes, and
    // its state again. Nothing changed, so nothing is registered or started.
    expect(m.taskCalls.slice(6)).toEqual(["query", "query", "query", "query", "query"]);
  });

  test("restore stops the task, removes it, and waits for its port to close", async () => {
    const m = machine({ windows: true });
    const server = fakeServer();
    m.writeConfig(server.port);
    expect((await m.runHere(["gateway", "setup"])).exitCode).toBe(0);
    expect((await m.runHere(["gateway", "on"])).exitCode).toBe(0);
    expect(m.task.state).toBe("Running");

    const done = await m.runHere(["restore", "--now", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(done.stdout).toContain(
      `- the task cc-smart-dev-kit-router: removed (port ${server.port} closed)\n`,
    );
    // The definition and the copy go with it; the config holds the person's key and stays.
    expect(done.stdout).toContain(
      "- ~/.local/share/cc-smart-dev-kit/router-task.xml: removed (cc-smart-dev-kit had created it)\n",
    );
    expect(existsSync(m.taskPath)).toBe(false);
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.config)).toBe(true);
    expect(m.task.registered).toBe(false);
    expect(m.taskCalls.slice(-3)).toEqual(["query", "stop", "unregister"]);
  });

  test("doctor: the task's state, its definition, and the router's answer", async () => {
    const m = machine({ windows: true });
    const server = fakeServer();
    m.writeConfig(server.port);
    expect((await m.runHere(["gateway", "setup"])).exitCode).toBe(0);
    const paths = cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir });
    const checks = () =>
      gatewayChecks({
        bundle: BUILT_ROUTER,
        fetch: m.probe.fetch,
        paths,
        runner: m.windowsRunner,
        service: "scheduled-task",
      });
    const line = (check: { info?: boolean; ok: boolean; text: string }) =>
      `${check.info === true ? "·" : check.ok ? "✓" : "✗"} ${check.text}`;
    expect((await checks()).map(line).slice(0, 4)).toEqual([
      "✓ the router service (the task cc-smart-dev-kit-router) is active",
      "✓ the router copy ~/.local/share/cc-smart-dev-kit/router.js is up to date",
      "✓ the task definition ~/.local/share/cc-smart-dev-kit/router-task.xml is up to date",
      `✓ the router answers on 127.0.0.1:${server.port}`,
    ]);

    // A task someone removed by hand: doctor says so, and the definition with it.
    m.task.registered = false;
    expect((await checks()).map(line).slice(0, 3)).toEqual([
      "✗ the router service (the task cc-smart-dev-kit-router) is not registered. Run: cc-smart-dev-kit gateway setup",
      "✓ the router copy ~/.local/share/cc-smart-dev-kit/router.js is up to date",
      "✗ the task definition ~/.local/share/cc-smart-dev-kit/router-task.xml is not registered as the task cc-smart-dev-kit-router. Run: cc-smart-dev-kit gateway setup",
    ]);

    // A task re-pointed at another program: the definition is right, the task is not.
    m.task.registered = true;
    m.task.action = {
      arguments: '--no-env-file "C:\\somewhere\\other.js"',
      execute: "C:\\other\\bun.exe",
      workingDirectory: "C:\\other",
    };
    expect((await checks()).map(line).slice(0, 3)).toEqual([
      "✓ the router service (the task cc-smart-dev-kit-router) is active",
      "✓ the router copy ~/.local/share/cc-smart-dev-kit/router.js is up to date",
      "✗ the task cc-smart-dev-kit-router does not run ~/.local/share/cc-smart-dev-kit/router.js. Run: cc-smart-dev-kit gateway setup",
    ]);
  });

  test("a Windows machine with no PowerShell: its own refusal, and nothing is written", async () => {
    const m = machine({ windows: true });
    const said: string[] = [];
    const code = await runGateway(["setup", "--no-backend-key"], {
      account: "MACHINE\\user",
      bunPath: process.execPath,
      bunVersion: Bun.version,
      bundle: BUILT_ROUTER,
      confirm: null,
      error: (line) => said.push(line),
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      platform: "win32",
      print: (line) => said.push(line),
      probe: m.probe,
      readStdin: () => Promise.resolve(""),
      runner: m.windowsRunner,
      service: "none",
    });
    expect(code).toBe(1);
    // Never the systemd sentence on a Windows machine: it names what is really missing.
    expect(said).toEqual([
      "the gateway service needs PowerShell, and this machine has none: with no PowerShell and no systemd, there is no way to run the router here.",
    ]);
    expect(existsSync(m.taskPath)).toBe(false);
    expect(existsSync(m.paths.copy)).toBe(false);
  });
});

describe("cc-smart-dev-kit gateway: the worker's targets and the judge test (D44)", () => {
  const SPAWNING_TEST_MS = 30_000;
  /** The proof the router checks, by hand from config.ts's `judgeTestProof` (test version 3). */
  const proofOf = (target: string, port: number) =>
    createHash("sha256")
      .update(`cc-smart-dev-kit judge test 3\n${target}\nhttp://127.0.0.1:${port}`)
      .digest("hex")
      .slice(0, 32);
  const PASSED_LINE =
    'judge test: omniroute:m1 blocked "git push --force origin main": it judges auto mode\'s checks while Claude is limited or down';
  const FAILED_LINE =
    'judge test: omniroute:m2 did not block "git push --force origin main" (let it run): it never judges; the worker slot uses it as before';

  test(
    "slot worker tests each target; only the one that blocked gets a proof, the worker is set either way",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block", m2: "allow" } });
      m.writeConfig(server.port);
      const set = await m.run(["gateway", "slot", "worker", "omniroute:m1,omniroute:m2"]);
      expect(set.stderr).toBe("");
      expect(set.exitCode).toBe(0);
      expect(set.stdout).toBe(
        [
          PASSED_LINE,
          FAILED_LINE,
          "cc-smart-dev-kit-worker: (new)",
          "  now: omniroute:m1 → omniroute:m2  (fallback on)",
          `  Auto mode's checks: Claude first; while Claude is limited or down: omniroute:m1 (fallback on); not tested, so never judging: omniroute:m2 (cc-smart-dev-kit gateway setup tests them)`,
          "WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
      expect(saved.slots["cc-smart-dev-kit-worker"]).toEqual(["omniroute:m1", "omniroute:m2"]);
      expect(saved.judgeTested).toEqual({ "omniroute:m1": proofOf("omniroute:m1", server.port) });
      // Both targets were asked the test, with the backend's own key.
      expect(server.judged.map((call) => call.model)).toEqual(["m1", "m2"]);
      expect(server.judged.map((call) => call.key)).toEqual([
        `Bearer ${PLANTED_KEY}`,
        `Bearer ${PLANTED_KEY}`,
      ]);
    },
    SPAWNING_TEST_MS,
  );

  test(
    "a worker chain of Claude alone, or off, tests nothing and writes no proof",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block" } });
      m.writeConfig(server.port);
      const claude = await m.run(["gateway", "slot", "worker", "claude-sonnet-5-5"]);
      expect(claude.stderr).toBe("");
      expect(claude.stdout).toBe(
        [
          "cc-smart-dev-kit-worker: (new)",
          "  now: claude-sonnet-5-5  (fallback on)",
          "  Auto mode's checks: Claude judges every check, alone (the worker chain has no affordable target to stand in)",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      expect(server.judged).toEqual([]);
      expect(JSON.parse(readFileSync(m.paths.config, "utf8"))).not.toHaveProperty("judgeTested");
    },
    SPAWNING_TEST_MS,
  );

  test(
    "a target already proven is not tested again; a target taken out of the worker chain loses its proof",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block", m2: "block" } });
      m.writeConfig(server.port);
      await m.run(["gateway", "slot", "worker", "omniroute:m1"]);
      expect(server.judged.map((call) => call.model)).toEqual(["m1"]);
      // m1 has its proof now: only m2 is asked.
      await m.run(["gateway", "slot", "worker", "omniroute:m1,omniroute:m2"]);
      expect(server.judged.map((call) => call.model)).toEqual(["m1", "m2"]);
      expect(JSON.parse(readFileSync(m.paths.config, "utf8")).judgeTested).toEqual({
        "omniroute:m1": proofOf("omniroute:m1", server.port),
        "omniroute:m2": proofOf("omniroute:m2", server.port),
      });
      // m2 leaves the chain, and its proof goes with it.
      await m.run(["gateway", "slot", "worker", "omniroute:m1"]);
      expect(JSON.parse(readFileSync(m.paths.config, "utf8")).judgeTested).toEqual({
        "omniroute:m1": proofOf("omniroute:m1", server.port),
      });
    },
    SPAWNING_TEST_MS,
  );

  test(
    "gateway setup tests the worker targets that have no proof, and says each result",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block", m2: "allow" } });
      m.writeConfig(server.port, { "cc-smart-dev-kit-worker": ["omniroute:m1", "omniroute:m2"] });
      const setup = await m.run(["gateway", "setup"]);
      expect(setup.stderr).toBe("");
      expect(setup.exitCode).toBe(0);
      expect(setup.stdout).toContain(`${PASSED_LINE}\n${FAILED_LINE}\n`);
      expect(setup.stdout).toContain(
        "WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action\n",
      );
      expect(JSON.parse(readFileSync(m.paths.config, "utf8")).judgeTested).toEqual({
        "omniroute:m1": proofOf("omniroute:m1", server.port),
      });
      // The second setup asks only the target that has no proof.
      server.judged.length = 0;
      await m.run(["gateway", "setup"]);
      expect(server.judged.map((call) => call.model)).toEqual(["m2"]);
    },
    SPAWNING_TEST_MS,
  );

  test(
    "status shows the one judge line, and doctor shows it without a failure for an untested target",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block", m2: "allow" } });
      m.writeConfig(server.port);
      m.useServer(server.port, {});
      expect((await m.run(["gateway", "setup"])).exitCode).toBe(0);
      await m.run(["gateway", "slot", "worker", "omniroute:m1,omniroute:m2"]);
      const status = await m.run(["gateway", "status"]);
      expect(status.stdout).toContain(
        [
          "  cc-smart-dev-kit-worker Custom: omniroute:m1 → omniroute:m2  (fallback on; breaker on)",
          "  cc-smart-dev-kit-fable Claude: fable goes to Anthropic as Claude Code sent it, on your own login",
          "  cc-smart-dev-kit-opus Claude: opus goes to Anthropic as Claude Code sent it, on your own login",
          "  cc-smart-dev-kit-judge Claude: Claude first; while Claude is limited or down: omniroute:m1 (fallback on); not tested, so never judging: omniroute:m2 (cc-smart-dev-kit gateway setup tests them)",
          "    WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
          "",
        ].join("\n"),
      );
      const checks = await gatewayChecks({
        paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
        bundle: BUILT_ROUTER,
        runner: () => ({ exitCode: 0, output: "active\n" }),
        service: "systemd",
        fetch: m.probe.fetch,
      });
      const judge = checks.filter((check) => check.text.startsWith("slot cc-smart-dev-kit-judge"));
      expect(
        judge.map(
          (check) => `${check.info ? "·" : check.warn ? "!" : check.ok ? "✓" : "✗"} ${check.text}`,
        ),
      ).toEqual([
        "· slot cc-smart-dev-kit-judge: Claude first; while Claude is limited or down: omniroute:m1 (fallback on); not tested, so never judging: omniroute:m2 (cc-smart-dev-kit gateway setup tests them)",
        "! slot cc-smart-dev-kit-judge: a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
      ]);
      expect(checks.filter((check) => !check.ok && !check.info)).toEqual([]);
    },
    SPAWNING_TEST_MS,
  );

  test(
    "fallback judge off keeps Claude alone with no judge chain; on puts the default back",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block" } });
      m.writeConfig(server.port);
      await m.run(["gateway", "slot", "worker", "omniroute:m1"]);
      const off = await m.run(["gateway", "fallback", "judge", "off"]);
      expect(off.stderr).toBe("");
      expect(off.exitCode).toBe(0);
      expect(off.stdout).toBe(
        [
          "cc-smart-dev-kit-judge: fallback on → off",
          "  Claude judges every check, alone (fallback off)",
          "  Only Claude judges; when it is limited or down, its error goes back to Claude Code.",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      expect(JSON.parse(readFileSync(m.paths.config, "utf8")).fallback).toEqual({
        "cc-smart-dev-kit-judge": false,
      });
      const on = await m.run(["gateway", "fallback", "judge", "on"]);
      expect(on.stdout).toBe(
        [
          "cc-smart-dev-kit-judge: fallback off → on",
          "  Claude first; while Claude is limited or down: omniroute:m1 (fallback on)",
          "  The worker's tested targets answer when Claude is limited or down.",
          "WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      expect(JSON.parse(readFileSync(m.paths.config, "utf8"))).not.toHaveProperty("fallback");
    },
    SPAWNING_TEST_MS,
  );

  test(
    "slot judge takes a claude-… target as it is, with no test; slot judge off keeps the worker's proofs",
    async () => {
      const m = machine();
      const server = fakeServer({ judge: { m1: "block", m2: "block" } });
      m.writeConfig(server.port);
      await m.run(["gateway", "slot", "worker", "omniroute:m1"]);
      const set = await m.run(["gateway", "slot", "judge", "claude-sonnet-5-5,omniroute:m2"]);
      expect(set.stderr).toBe("");
      expect(set.exitCode).toBe(0);
      expect(set.stdout).toBe(
        [
          "judge: claude-sonnet-5-5 is Claude: no test needed; it judges as the model it names",
          'judge test: omniroute:m2 blocked "git push --force origin main"',
          "cc-smart-dev-kit-judge: (new)",
          "  now: claude-sonnet-5-5 → omniroute:m2  (fallback on)",
          "WARN a judge other than Claude decides worse: it can block good work or let a risky command through, and every check sends it the conversation and the next action",
          "The router uses it from its next request.",
          "",
        ].join("\n"),
      );
      const saved = JSON.parse(readFileSync(m.paths.config, "utf8"));
      expect(saved.slots["cc-smart-dev-kit-judge"]).toEqual(["claude-sonnet-5-5", "omniroute:m2"]);
      expect(saved.judgeTested).toEqual({
        "omniroute:m1": proofOf("omniroute:m1", server.port),
        "omniroute:m2": proofOf("omniroute:m2", server.port),
      });
      // Off: m2's proof goes (no chain holds it), the worker's m1 stays.
      expect((await m.run(["gateway", "slot", "judge", "off"])).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(m.paths.config, "utf8")).judgeTested).toEqual({
        "omniroute:m1": proofOf("omniroute:m1", server.port),
      });
    },
    SPAWNING_TEST_MS,
  );
});
