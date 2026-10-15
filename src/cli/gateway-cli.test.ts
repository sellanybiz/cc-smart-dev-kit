/**
 * `anymodel gateway …` end to end, as a person runs it: a temp HOME and config folder,
 * a fake `systemctl` alone on PATH (it logs each call and keeps the unit's state in a
 * file), and a fake backend and router health page served by this test on a free port.
 *
 * Nothing here reaches the real systemd, the real ~/.claude or a real gateway: PATH holds
 * only the fake, and every config this file writes names the fake server's port. Never run
 * the router or `status` here without such a config: the default port belongs to a router
 * that may be running on this machine.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");
const BUILT_ROUTER = join(import.meta.dir, "..", "..", "plugin", "dist", "router.js");
/** A made-up backend key: it must never show in any output. */
const PLANTED_KEY = "sk-planted-SECRET-0123456789abcdef";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A fake OmniRoute (`/v1/models`) and a fake router health page, on one free port. */
function fakeServer(options: { modelsStatus?: number } = {}) {
  const seenKeys: string[] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req): Response {
      const url = new URL(req.url);
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
  return { port: server.port as number, seenKeys };
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
        `  *disable*) echo inactive > '${state}' ;;`,
        `  *restart*|*--now*) echo active > '${state}' ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(fakeBin, "systemctl"), 0o755);
  }
  const env = { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: fakeBin };
  const run = async (args: string[], input?: string, cli = CLI) => {
    const proc = Bun.spawn([process.execPath, cli, ...args], {
      env,
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
  return { home, env, run, paths, calls, state, useServer, writeConfig };
}

describe("anymodel gateway setup", () => {
  test("installs the copy and the unit, starts it, and changes nothing the second time", async () => {
    const m = machine();
    const first = await m.run(["gateway", "setup", "--no-backend-key"]);
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
        "--user restart anymodel-router.service",
        "",
      ].join("\n"),
    );

    const again = await m.run(["gateway", "setup", "--no-backend-key"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("router already up to date (no restart)\n");
    expect(m.calls().endsWith("--user enable --now anymodel-router.service\n")).toBe(true);
  });

  test("a running router with a changed copy: no restart without --yes; with --yes, the restart", async () => {
    const m = machine();
    await m.run(["gateway", "setup", "--no-backend-key"]);
    writeFileSync(m.paths.copy, "// an older router\n");
    const before = m.calls();
    const refused = await m.run(["gateway", "setup", "--no-backend-key"]);
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

    const yes = await m.run(["gateway", "setup", "--no-backend-key", "--yes"]);
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

  test("the key comes on stdin, never argv; the config is mode 600", async () => {
    const m = machine();
    const result = await m.run(
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
    const argv = await m.run(["gateway", "setup", "--backend-key-stdin", "omniroute", PLANTED_KEY]);
    expect(argv.exitCode).toBe(2);
    expect(`${argv.stdout}${argv.stderr}`).not.toContain(PLANTED_KEY);
  });

  test("restore stops the router (after a yes), then removes the copy, the unit and the env keys", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    writeFileSync(m.paths.settings, '{ "model": "opus" }\n');
    await m.run(["gateway", "setup", "--no-backend-key"]);
    expect((await m.run(["gateway", "on"])).exitCode).toBe(0);

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

    const before = m.calls();
    const done = await m.run(["restore", "--yes"]);
    expect(done.exitCode).toBe(0);
    expect(m.calls().slice(before.length)).toBe(
      [
        "--user is-active --quiet anymodel-router.service",
        "--user disable --now anymodel-router.service",
        "--user daemon-reload",
        "",
      ].join("\n"),
    );
    expect(done.stdout).toContain("- anymodel-router.service: stopped and disabled\n");
    expect(existsSync(m.paths.copy)).toBe(false);
    expect(existsSync(m.paths.unit)).toBe(false);
    expect(JSON.parse(readFileSync(m.paths.settings, "utf8"))).toEqual({ model: "opus", env: {} });
    // The config holds the person's key: restore leaves it.
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

  test("a config others can read: ✗ naming chmod 600", async () => {
    const m = machine();
    const server = fakeServer();
    m.writeConfig(server.port);
    chmodSync(m.paths.config, 0o644);
    const doctor = await m.run(["doctor"]);
    expect(doctor.stdout).toContain(
      `✗ gateway config: ${m.paths.config} can be read by other users (mode 644); it holds API keys. Run: chmod 600 ${m.paths.config}\n`,
    );
  });
});

describe("secrets", () => {
  test("no command ever prints the backend key, the broken config's text included", async () => {
    const m = machine();
    const server = fakeServer();
    const outputs: string[] = [];
    const record = (result: { stdout: string; stderr: string }) => {
      outputs.push(result.stdout, result.stderr);
      return result;
    };
    record(await m.run(["gateway", "setup", "--backend-key-stdin", "omniroute"], PLANTED_KEY));
    m.useServer(server.port);
    record(await m.run(["gateway", "setup", "--backend-key-stdin", "omniroute"], PLANTED_KEY));
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
    // A broken file: the error must not quote the text around the mistake.
    writeFileSync(m.paths.config, `{"backends":{"omniroute":{"apiKey":"${PLANTED_KEY}",}}}`, {
      mode: 0o600,
    });
    // Not `status` from here on: without a good config it asks the default port, which may
    // belong to a router running on this machine.
    record(await m.run(["gateway", "models"]));
    record(await m.run(["gateway", "slot", "worker", "claude-sonnet-5-5"]));
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

    // The backend did receive the key: the test would see a leak if one were printed.
    expect(server.seenKeys).toContain(`Bearer ${PLANTED_KEY}`);
    const all = outputs.join("\n");
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
    // The fake server only lent its free port: stop it, and the router takes the port.
    for (const s of servers.splice(0)) s.stop(true);
    m.writeConfig(port);
    await m.run(["gateway", "setup"]);
    const proc = Bun.spawn([process.execPath, "--no-env-file", m.paths.copy], {
      env: m.env,
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
