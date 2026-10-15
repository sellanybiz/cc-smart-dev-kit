/**
 * `anymodel gateway …` end to end, as a person runs it: a temp HOME and config folder,
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
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runGateway } from "../gateway/commands";
import { gatewayChecks } from "../gateway/doctor";
import type { HealthProbe } from "../gateway/health";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { runRestore } from "./restore";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const BUILT_ROUTER = join(import.meta.dir, "..", "..", "plugin", "dist", "router.js");
/** A made-up backend key: it must never show in any output. */
const PLANTED_KEY = "sk-planted-SECRET-0123456789abcdef";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/**
 * A fake OmniRoute (`/v1/models`, and `anymodel search`'s `/v1/search` and
 * `/v1/web/fetch`) and a fake router health page, on one free port. Its search answers
 * 401 with the key it was sent echoed back, as an upstream may.
 */
function fakeServer(options: { modelsStatus?: number } = {}) {
  const seenKeys: string[] = [];
  const searchKeys: string[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req): Response {
      const url = new URL(req.url);
      if (url.pathname === "/v1/search" || url.pathname === "/v1/web/fetch") {
        const authorization = req.headers.get("authorization") ?? "";
        searchKeys.push(authorization);
        if (url.pathname === "/v1/web/fetch") {
          return Response.json({ content: "Page text.", url: "https://example.com/" });
        }
        return Response.json(
          { error: { message: `invalid key in "${authorization}"` } },
          { status: 401 },
        );
      }
      if (url.pathname === "/v1/models") {
        seenKeys.push(req.headers.get("authorization") ?? "");
        if (options.modelsStatus !== undefined && options.modelsStatus !== 200) {
          return new Response("no", { status: options.modelsStatus });
        }
        return Response.json({ data: [{ id: "m1" }, { context_length: 200000, id: "m2" }] });
      }
      if (url.pathname === "/__anymodel/health") {
        return Response.json({
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
  return { port: server.port as number, searchKeys, seenKeys };
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

/** A temp machine: HOME, config folder, a fake systemctl alone on PATH. */
function machine(options: { systemctl?: boolean } = {}) {
  const home = tempDir("gateway-cli");
  const configDir = join(home, ".claude");
  mkdirSync(configDir, { recursive: true });
  const fakeBin = join(home, "fake-bin");
  mkdirSync(fakeBin);
  const log = join(home, "systemctl.log");
  const state = join(home, "unit-state");
  if (options.systemctl !== false) {
    // Shell builtins only: PATH holds nothing else.
    writeFileSync(
      join(fakeBin, "systemctl"),
      [
        "#!/bin/sh",
        `echo "$*" >> '${log}'`,
        "s=inactive",
        `[ -e '${state}' ] && read s < '${state}'`,
        'case "$*" in',
        '  *is-active*) [ "$1" = "--user" ] || exit 9; case "$*" in *--quiet*) ;; *) echo "$s" ;; esac; [ "$s" = active ] && exit 0; exit 3 ;;',
        // `disable` alone leaves a running unit running, as systemd does; `stop` stops it.
        `  *disable*--now*|*" stop "*) echo inactive > '${state}' ;;`,
        `  *restart*|*--now*) echo active > '${state}' ;;`,
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
    config: join(home, ".config", "anymodel", "gateway.json"),
    copy: join(home, ".local", "share", "anymodel", "router.js"),
    unit: join(home, ".config", "systemd", "user", "anymodel-router.service"),
    settings: join(configDir, "settings.json"),
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");

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
      const unit = existsSync(state) ? readFileSync(state, "utf8").trim() : "inactive";
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
   * `anymodel gateway …` or `anymodel restore …` in this process, for a command that
   * asks a port: the same temp machine and fake systemctl, but the fake health page
   * above, so no test reaches a router that may run on this machine (and a stopped unit
   * frees its port, which a fake server in this process cannot do for a subprocess).
   * Output as the CLI prints it.
   */
  const runHere = async (args: string[], input?: string) => {
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
              runner,
              systemd: options.systemctl !== false,
              confirm: null,
              probe,
            })
          : await runGateway(args.slice(1), {
              paths,
              bunPath: process.execPath,
              // The Bun running the tests: the preload stops an older one.
              bunVersion: Bun.version,
              bundle: BUILT_ROUTER,
              runner,
              readStdin: () => Promise.resolve(input ?? ""),
              confirm: null,
              systemd: options.systemctl !== false,
              probe,
            });
    } catch (thrown) {
      // What the CLI's own catch prints (src/entries/cli.ts).
      err.push(`anymodel: ${thrown instanceof Error ? thrown.message : String(thrown)}\n`);
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
  const writeConfig = (port: number, slots: Record<string, string[]> = {}) => {
    mkdirSync(dirname(paths.config), { recursive: true });
    writeFileSync(
      paths.config,
      JSON.stringify({
        backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: `http://127.0.0.1:${port}` } },
        port,
        slots: { "anymodel-scout": ["omniroute:m1", "claude-sonnet-5-5"], ...slots },
        version: 1,
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
    probe,
    probed,
    port,
    clock,
    paths,
    calls,
    state,
    useServer,
    writeConfig,
  };
}

describe("anymodel gateway setup", () => {
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
        `no config at ~/.config/anymodel/gateway.json yet: the router answers every slot on your own Claude login until the OmniRoute key is added (setup --backend-key-stdin omniroute)`,
        "+ ~/.local/share/anymodel/router.js: router copy created",
        "+ ~/.config/systemd/user/anymodel-router.service: unit created",
        "enabled and (re)started anymodel-router.service",
        "Claude Code does not use the gateway yet. Check it: anymodel gateway status. Then: anymodel gateway on.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.copy).equals(readFileSync(BUILT_ROUTER))).toBe(true);
    expect(readFileSync(m.paths.unit, "utf8")).toContain(
      `\nExecStart="${process.execPath}" --no-env-file "${m.paths.copy}"\n`,
    );
    expect(existsSync(m.paths.config)).toBe(false);
    expect(m.calls()).toBe(
      [
        // The read-only pass, then the writing pass, each asks once.
        "--user is-active --quiet anymodel-router.service",
        "--user is-active --quiet anymodel-router.service",
        "--user daemon-reload",
        "--user enable anymodel-router.service",
        // Changed on purpose: a unit that is not active is asked its state before the
        // restart, to say when an old router still drains.
        "--user is-active anymodel-router.service",
        "--user restart anymodel-router.service",
        "",
      ].join("\n"),
    );
    // No config: the default port. Asked of the fake, before each pass and after the restart.
    expect(m.probed).toEqual([
      "http://127.0.0.1:20100/__anymodel/health",
      "http://127.0.0.1:20100/__anymodel/health",
      "http://127.0.0.1:20100/__anymodel/health",
    ]);

    const again = await m.runHere(["gateway", "setup", "--no-backend-key"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("router already up to date (no restart)\n");
    expect(m.calls().endsWith("--user enable --now anymodel-router.service\n")).toBe(true);
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
        "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).",
        "Nothing was changed. Run again with --yes to restart: anymodel gateway setup --yes",
        "",
      ].join("\n"),
    );
    expect(readFileSync(m.paths.copy, "utf8")).toBe("// an older router\n");
    expect(m.calls().slice(before.length)).toBe(
      "--user is-active --quiet anymodel-router.service\n",
    );

    const yes = await m.run(["gateway", "setup", "--yes"]);
    expect(yes.exitCode).toBe(0);
    expect(yes.stdout).toContain(
      "anymodel-router is running. A restart cuts the answers in flight in running Claude sessions on this machine (Claude Code retries them).\n",
    );
    expect(yes.stdout).toContain("~ ~/.local/share/anymodel/router.js: router copy updated\n");
    expect(yes.stdout).toContain("restarting anymodel-router\n");
    expect(m.calls().endsWith("--user restart anymodel-router.service\n")).toBe(true);
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
    expect(result.stdout.split("\n")[0]).toBe("created ~/.config/anymodel/gateway.json (mode 600)");
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

describe("anymodel gateway setup: the port", () => {
  test("a port another program uses: setup refuses before any question, and writes nothing", async () => {
    const m = machine();
    const other = otherProgram();
    m.writeConfig(other.port);
    const result = await m.run(["gateway", "setup", "--yes"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `anymodel: port ${other.port} is used by another program (an older router? stop it first)\n`,
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(existsSync(join(m.home, ".claude", "anymodel"))).toBe(false);
    expect(m.calls()).toBe("");
  });
});

describe("anymodel restore: the gateway in two stages", () => {
  const STAGE_1_KEYS =
    "~ ~/.claude/settings.json: removed env.ENABLE_TOOL_SEARCH, env.ANTHROPIC_BASE_URL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION, env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION, env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME; everything else kept";

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
    expect(lines[1]).toStartWith("  (its state before this restore: ~/.claude/anymodel/backups/");
    expect(lines[2]).toBe(
      "Restart every running Claude session (they still use the router), then run `anymodel restore` again to stop and remove the router.",
    );
    expect(lines[3]).toBe("");
    // The router keeps running: nothing was stopped, nothing asked of systemd.
    expect(m.calls().slice(before.length)).toBe("");
    expect(existsSync(m.paths.copy)).toBe(true);
    expect(existsSync(m.paths.unit)).toBe(true);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus", env: {} });

    // Stage 2: no gateway key left. Stopping a running router still asks first.
    const refused = await m.run(["restore"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe(
      [
        "anymodel-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.",
        "Nothing was changed. Run again with --yes to stop it: anymodel restore --yes",
        "",
      ].join("\n"),
    );
    expect(existsSync(m.paths.copy)).toBe(true);

    // A setup that did not finish has nothing left to finish once the router is gone.
    const marker = join(m.configDir, "anymodel", "restart-pending");
    writeFileSync(marker, "pending\n");
    // Reworked: in this process (`runHere`), because the stop now asks the router's port
    // until it closes, and the fake server of this test cannot close for a subprocess.
    // It was `disable --now`, which waits for the router's whole drain (up to 120 s).
    const middle = m.calls();
    const done = await m.runHere(["restore", "--yes"]);
    expect(done.stderr).toBe("");
    expect(done.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(m.calls().slice(middle.length)).toBe(
      [
        "--user is-active --quiet anymodel-router.service",
        // Changed on purpose: the stop asks the unit's state, to wait only for its own port.
        "--user is-active anymodel-router.service",
        "--user disable anymodel-router.service",
        "--user stop --no-block anymodel-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    // The config's port was asked once the stop was sent, and it was closed.
    expect(m.probed).toEqual([`http://127.0.0.1:${server.port}/__anymodel/health`]);
    expect(done.stdout).toContain(
      `- anymodel-router.service: disabled and stopped (port ${server.port} closed; answers in flight finish in the background)\n`,
    );
    expect(done.stdout).toContain(
      "- ~/.local/share/anymodel/router.js: removed (anymodel had created it)\n",
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    // The config holds the person's key: restore leaves it.
    expect(existsSync(m.paths.config)).toBe(true);
    // A third restore has nothing left to do.
    expect((await m.run(["restore"])).stdout).toBe(
      "Nothing to restore: anymodel has nothing in any file.\n",
    );
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
        "restore --now stops anymodel-router while Claude sessions still use it: every running Claude session fails until it restarts.",
        "Nothing was changed. Run again with --yes to do it now: anymodel restore --now --yes",
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
      `restore --now stops anymodel-router while Claude sessions still use it: every running Claude session fails until it restarts.\n- anymodel-router.service: disabled and stopped (port ${server.port} closed; answers in flight finish in the background)\n`,
    );
    expect(done.stdout).toContain(`${STAGE_1_KEYS}\n`);
    // The warning above is the question: no `is-active --quiet` first. Changed on purpose:
    // the stop asks the unit's state (no --quiet), to wait only for its own port.
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user is-active anymodel-router.service",
        "--user disable anymodel-router.service",
        "--user stop --no-block anymodel-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(m.probed).toEqual([`http://127.0.0.1:${server.port}/__anymodel/health`]);
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus", env: {} });
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
      `anymodel: anymodel-router.service is disabled and was told to stop, but 127.0.0.1:${server.port} still takes connections after 15 s. Nothing else was restored. See why: systemctl --user status anymodel-router (and ss -ltnp for another program on the port). Then run anymodel restore again.\n`,
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
    "restore --now stops anymodel-router while Claude sessions still use it: every running Claude session fails until it restarts.";

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
        "- anymodel-router.service: disabled and stopping",
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
        `  anymodel-router.service was not running (systemctl --user is-active: activating); not waiting for port ${server.port}`,
        "- anymodel-router.service: disabled and stopped",
        "",
      ].join("\n"),
    );
    expect(m.clock.now - started).toBe(0);
    // The unit's state decided it: the port was not even asked.
    expect(m.probed).toEqual([]);
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user is-active anymodel-router.service",
        "--user disable anymodel-router.service",
        "--user stop --no-block anymodel-router.service",
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
        "- anymodel-router.service: disabled and stopping",
        "",
      ].join("\n"),
    );
    expect(done.stdout).not.toContain(PLANTED_KEY);
    expect(m.probed).toEqual([]);
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user disable anymodel-router.service",
        "--user stop --no-block anymodel-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(existsSync(m.paths.copy)).toBe(false);
    // The config holds the person's key: restore leaves it, even broken.
    expect(existsSync(m.paths.config)).toBe(true);
  });
});

describe("anymodel gateway on / off", () => {
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
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_HAIKU_MODEL: (none) -> "anymodel-scout[1m]"',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: (none) -> "Cheap model for search and reading: the scout slot (anymodel gateway slot scout …)"',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: (none) -> "Scout (cheap)"',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_SONNET_MODEL: (none) -> "anymodel-worker[1m]"',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: (none) -> "Cheap model for routine code and docs: the worker slot (anymodel gateway slot worker …)"',
        '~ ~/.claude/settings.json: env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: (none) -> "Worker (cheap)"',
        "Done. The changed file has a backup in ~/.claude/anymodel/backups/.",
        "Every Claude Code session on this machine, in every folder, uses the gateway from now on: its haiku / sonnet work (background titles and summaries too) goes to the cheap slots.",
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
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus", env: {} });
  });

  test("a gateway key someone else set stops on: ForeignKeyError, nothing written", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const settings = `${JSON.stringify({ env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "old-scout[1m]" } }, null, 2)}\n`;
    writeFileSync(m.paths.settings, settings);
    const on = await m.run(["gateway", "on"]);
    expect(on.exitCode).toBe(1);
    expect(on.stderr).toBe(
      `anymodel: ${m.paths.settings}: env.ANTHROPIC_DEFAULT_HAIKU_MODEL is old-scout[1m], set by someone else. anymodel does not overwrite it. Remove it by hand if anymodel should manage it.\n`,
    );
    expect(readFileSync(m.paths.settings, "utf8")).toBe(settings);
    expect(existsSync(join(m.home, ".claude", "anymodel"))).toBe(false);
  });

  test("on refuses while the router does not answer: every request would fail", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    for (const s of servers.splice(0)) s.stop(true);
    const on = await m.run(["gateway", "on"]);
    expect(on.exitCode).toBe(1);
    expect(on.stderr).toStartWith(
      `anymodel: the router does not answer on 127.0.0.1:${server.port} (`,
    );
    expect(existsSync(m.paths.settings)).toBe(false);
  });
});

describe("anymodel doctor: the gateway", () => {
  test("set up and running: the unit, the copy, the health page, the backend, each slot's first target", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port, { "anymodel-worker": ["claude-sonnet-5-5"] });
    await m.run(["gateway", "setup"]);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toEndWith(
      [
        "✓ the router service (anymodel-router.service) is active",
        "✓ the router copy ~/.local/share/anymodel/router.js is up to date",
        `✓ the router answers on 127.0.0.1:${server.port}`,
        `✓ backend omniroute (http://127.0.0.1:${server.port}) answers`,
        "· slot anymodel-scout: first target omniroute:m1",
        "· slot anymodel-worker: first target claude-sonnet-5-5",
        "· slot anymodel-judge: off, auto mode's safety checks go to Claude",
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
      "✗ the router service (anymodel-router.service) is inactive. Run: anymodel gateway setup\n",
    );
    expect(doctor.stdout).toContain(
      "✗ the router copy ~/.local/share/anymodel/router.js is not this plugin version's router. Run: anymodel gateway setup\n",
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

describe("anymodel doctor: a gateway that is not installed, or half", () => {
  test("gateway.json alone (restore keeps it): information, not a failure", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toContain(
      "· gateway.json kept (~/.config/anymodel/gateway.json); the gateway is not installed. To use it: anymodel gateway setup\n",
    );
    expect(doctor.stdout).not.toContain("router");
    expect(m.calls()).toBe("");
  });

  test("the restart-pending marker: ✗ whatever else is there", async () => {
    const m = machine();
    mkdirSync(join(m.configDir, "anymodel"), { recursive: true });
    writeFileSync(join(m.configDir, "anymodel", "restart-pending"), "pending\n");
    const doctor = await m.run(["doctor"]);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.stdout).toContain(
      "✗ a gateway setup did not finish; run: anymodel gateway setup\n· gateway: not set up (optional). To use it: anymodel gateway setup\n",
    );
  });

  test("set up with no gateway.json: the router's default port, every slot on Claude, as information", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    m.probed.length = 0;
    const checks = await gatewayChecks({
      paths: cliPaths({ HOME: m.home, CLAUDE_CONFIG_DIR: m.configDir }),
      bundle: BUILT_ROUTER,
      runner: () => ({ exitCode: 0, output: "active\n" }),
      systemd: true,
      fetch: m.probe.fetch,
    });
    expect(
      checks.map((check) => `${check.info ? "·" : check.ok ? "✓" : "✗"} ${check.text}`),
    ).toEqual([
      "✓ the router service (anymodel-router.service) is active",
      "✓ the router copy ~/.local/share/anymodel/router.js is up to date",
      "· no ~/.config/anymodel/gateway.json yet: the router answers every slot on your own Claude login. To add a backend: anymodel gateway setup --backend-key-stdin omniroute < key-file",
      "✓ the router answers on 127.0.0.1:20100",
      "· slot anymodel-scout: first target claude-sonnet-5-5",
      "· slot anymodel-worker: first target claude-sonnet-5-5",
      "· slot anymodel-judge: off, auto mode's safety checks go to Claude",
    ]);
    // Asked of the fake, never the network.
    expect(m.probed).toEqual(["http://127.0.0.1:20100/__anymodel/health"]);
  });
});

describe("anymodel gateway slot: the file", () => {
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
        slots: { "anymodel-scout": ["omniroute:m1", "claude-sonnet-5-5"] },
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
        "anymodel-scout": ["omniroute:m1", "claude-sonnet-5-5"],
        "anymodel-worker": ["claude-sonnet-5-5"],
      },
      timeouts: { firstByteMs: 5000, idleMs: 9000 },
      version: 1,
    });
    expect(statSync(m.paths.config).mode & 0o777).toBe(0o600);
    // It saved under the lock (which made the state folder), and let it go.
    expect(existsSync(join(m.configDir, "anymodel"))).toBe(true);
    expect(existsSync(join(m.configDir, "anymodel", "lock"))).toBe(false);
  });
});

describe("anymodel gateway on: no gateway.json", () => {
  test("on uses the default port, after its health check, when there is no config", async () => {
    const m = machine();
    expect((await m.runHere(["gateway", "setup", "--no-backend-key"])).exitCode).toBe(0);
    m.probed.length = 0;
    const on = await m.runHere(["gateway", "on"]);
    expect(on.stderr).toBe("");
    expect(on.exitCode).toBe(0);
    expect(m.probed).toEqual(["http://127.0.0.1:20100/__anymodel/health"]);
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
      "anymodel: the router does not answer on 127.0.0.1:20100 (Unable to connect.",
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
    record(await m.run(["gateway", "slot", "worker", "omniroute:nope"]));
    record(await m.run(["gateway", "on"]));
    record(await m.run(["gateway", "status"]));
    record(await m.run(["gateway", "off"]));
    record(await m.run(["doctor"]));
    record(await m.run(["gateway", "help"]));
    record(await m.run(["gateway", "setup", "--backend-key-stdin"], PLANTED_KEY));
    // `anymodel search` reads the same config and key: its search answers 401 with the key
    // echoed, its fetch a page.
    const searchFailed = record(await m.run(["search", "bun runtime"]));
    record(await m.run(["search", "--json", "bun runtime"]));
    record(await m.run(["search", "--fetch", "https://example.com/"]));
    record(await m.run(["search", "--json", "--fetch", "https://example.com/"]));
    record(await m.run(["search", "--max", "99", "bun runtime"]));
    // A broken file: the error must not quote the text around the mistake.
    writeFileSync(m.paths.config, `{"backends":{"omniroute":{"apiKey":"${PLANTED_KEY}",}}}`, {
      mode: 0o600,
    });
    // Not `status` from here on: without a good config it asks the default port, which may
    // belong to a router running on this machine.
    record(await m.run(["gateway", "models"]));
    record(await m.run(["gateway", "slot", "worker", "claude-sonnet-5-5"]));
    record(await m.run(["doctor"]));
    record(await m.run(["search", "bun runtime"]));
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
    record(await m.run(["search", "bun runtime"]));
    const all = outputs.join("\n");

    // The backend did receive the key: the test would see a leak if one were printed.
    expect(server.seenKeys).toContain(`Bearer ${PLANTED_KEY}`);
    // So did the search and the fetch, four times; the broken configs never sent it.
    expect(server.searchKeys).toEqual(Array(4).fill(`Bearer ${PLANTED_KEY}`));
    // The failed search printed the echoed key masked.
    expect(searchFailed.exitCode).toBe(1);
    expect(searchFailed.stderr).toStartWith(
      'OmniRoute answered HTTP 401: invalid key in "Bearer ****cdef"\n',
    );
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
        `anymodel-router listening on http://127.0.0.1:${port} (config ${m.paths.config})\n`,
      );
      const response = await fetch(`http://127.0.0.1:${port}/__anymodel/health`);
      expect(await response.json()).toMatchObject({ ok: true, port, requests: 0 });
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 20_000);
});
