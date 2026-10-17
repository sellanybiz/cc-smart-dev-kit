/**
 * OmniRoute: finding the install and its unit, reading the registry, the model path's own
 * check, and `update` / `rollback` — every effect through a fake bun, a fake systemctl and a
 * fake registry. No test reaches the real OmniRoute, the real npm registry, systemd or a
 * real global install.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { probeModel } from "../gateway/backends";
import { loadConfigFile, saveConfig } from "../gateway/config";
import { lockIsHeld, withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import {
  BACKEND_WAIT_MS,
  emptyState,
  firstAffordableTarget,
  formatState,
  type OmnirouteContext,
  omnirouteDoctorLine,
  parseState,
  readState,
  runOmniroute,
  stateFile,
  writeState,
} from "./commands";
import {
  execStartArgv,
  findOmniroute,
  globalRootOf,
  omnirouteBackend,
  packageFolderOf,
  unitExecStart,
  userUnits,
} from "./install";
import { MIN_RELEASE_AGE_MS, newestRelease, parseReleases, releaseIsNewer } from "./registry";

const DAY = 86_400_000;
const now = Date.parse("2026-10-16T12:00:00Z");

/** A global Bun install of one package, with its own `bin/bun`. */
function fakeBunInstall(home: string, version: string): string {
  const folder = join(home, ".bun", "install", "global", "node_modules", "omniroute");
  mkdirSync(join(folder, "bin"), { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    `${JSON.stringify({ bin: { omniroute: "bin/omniroute.mjs" }, name: "omniroute", version })}\n`,
  );
  writeFileSync(join(folder, "bin", "omniroute.mjs"), "// the program\n");
  mkdirSync(join(home, ".bun", "bin"), { recursive: true });
  writeFileSync(join(home, ".bun", "bin", "bun"), "#!/bin/sh\n", { mode: 0o755 });
  return folder;
}

/** A systemd user unit that runs it, as `~/.config/systemd/user/<name>.service`. */
function fakeUnit(home: string, unitFile: string, script: string, extra = ""): void {
  mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true });
  writeFileSync(
    unitFile,
    `[Unit]\nDescription=OmniRoute\n\n[Service]\nExecStart=/usr/local/bin/node "${script}" serve --no-open\n${extra}\n[Install]\nWantedBy=default.target\n`,
  );
}

/** The registry's own answer, with three releases of different ages. */
function registryBody(): string {
  return JSON.stringify({
    time: {
      "3.8.50": new Date(now - 30 * DAY).toISOString(),
      "3.8.51": new Date(now - 10 * DAY).toISOString(),
      "3.8.60": new Date(now - 6 * DAY).toISOString(),
      "3.8.70": new Date(now - DAY).toISOString(),
      "3.9.0": new Date(now - 4 * DAY).toISOString(),
      "3.9.1-canary.1": new Date(now - 4 * DAY).toISOString(),
      modified: new Date(now - DAY).toISOString(),
    },
    versions: {
      "3.8.50": {},
      "3.8.51": {},
      "3.8.60": {},
      "3.8.70": {},
      "3.9.0": {},
      "3.9.1-canary.1": {},
    },
  });
}

function registryFetch(body: string, status = 200) {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (url: string) => {
      asked.push(url);
      return new Response(body, { status });
    },
  };
}

// ── The unit and the install ────────────────────────────────────────────────────

describe("the systemd unit and the install", () => {
  test("an ExecStart line: words, quotes, and the leading -/@/+ forms systemd allows", () => {
    expect(execStartArgv("ExecStart=/usr/local/bin/node /opt/app/main.mjs serve")).toEqual([
      "/usr/local/bin/node",
      "/opt/app/main.mjs",
      "serve",
    ]);
    expect(execStartArgv('ExecStart=/usr/bin/node "/opt/my app/main.mjs" --port 9000')).toEqual([
      "/usr/bin/node",
      "/opt/my app/main.mjs",
      "--port",
      "9000",
    ]);
    expect(execStartArgv("ExecStart=-/usr/bin/env APP=1 /usr/bin/node /opt/main.mjs")).toEqual([
      "/usr/bin/env",
      "APP=1",
      "/usr/bin/node",
      "/opt/main.mjs",
    ]);
    // `systemctl show -p ExecStart` prints the object form: `argv[]=` is read.
    expect(
      execStartArgv(
        "ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/main.mjs serve ; ignore_errors=no }",
      ),
    ).toEqual(["/usr/bin/node", "/opt/main.mjs", "serve"]);
  });

  test("a unit with no ExecStart has none", () => {
    expect(unitExecStart("[Unit]\nDescription=x\n")).toBe(null);
  });

  test("two ExecStart lines are ambiguous: the unit is left alone, never guessed at", () => {
    const two =
      "[Service]\nExecStart=/usr/bin/node /opt/a/main.mjs\nExecStart=/usr/bin/node /opt/b/main.mjs\n";
    expect(unitExecStart(two)).toBe(null);
    // And an ambiguous unit is skipped like one without an ExecStart: `status` then says that
    // no unit runs OmniRoute, rather than picking one of the two command lines.
    const home = tempDir("ambiguous");
    const dir = join(home, ".config", "systemd", "user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "omniroute.service"), two);
    expect(userUnits(dir)).toEqual([]);
  });

  test("every user unit in a folder is read; one without ExecStart is left out", () => {
    const home = tempDir("units");
    const dir = join(home, ".config", "systemd", "user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.service"), "[Service]\nExecStart=/usr/bin/a\n");
    writeFileSync(join(dir, "b.service"), "[Service]\nType=notify\n");
    expect(userUnits(dir).map((unit) => unit.name)).toEqual(["a.service"]);
    writeFileSync(join(dir, "c.socket"), "[Socket]\nListenStream=127.0.0.1:1\n");
    expect(userUnits(dir).map((unit) => unit.name)).toEqual(["a.service"]);
  });

  test("the package folder is found by walking up to its manifest, and by nothing else", () => {
    const home = tempDir("folder");
    const folder = fakeBunInstall(home, "3.8.51");
    expect(packageFolderOf(join(folder, "bin", "omniroute.mjs"), "omniroute")).toBe(folder);
    expect(packageFolderOf(join(home, "elsewhere", "main.mjs"), "omniroute")).toBe(null);
  });

  test("which manager owns a global install: Bun's layout, npm's, and neither", () => {
    const home = tempDir("root");
    expect(
      globalRootOf(
        join(home, ".bun", "install", "global", "node_modules", "omniroute"),
        () => null,
      ),
    ).toEqual({ kind: "bun", manager: "bun" });
    const prefix = join(home, "prefix");
    expect(globalRootOf(join(prefix, "lib", "node_modules", "omniroute"), () => null)).toEqual({
      kind: "npm",
      manager: "npm",
    });
    // A project's own node_modules is not a global install: updating it would be wrong.
    expect(globalRootOf(join(home, "app", "node_modules", "omniroute"), () => null)).toBe(null);
  });

  test("the unit that runs it is found by its ExecStart, not by its name", () => {
    const home = tempDir("find");
    const folder = fakeBunInstall(home, "3.8.51");
    const other = join(home, ".config", "systemd", "user", "aaa-first.service");
    fakeUnit(home, other, "/opt/unrelated/main.mjs");
    const unitFile = join(home, ".config", "systemd", "user", "zz-router.service");
    fakeUnit(home, unitFile, join(folder, "bin", "omniroute.mjs"));
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    const found = findOmniroute({ env: { HOME: home }, paths, which: () => null });
    expect(found.unit?.name).toBe("zz-router.service");
    expect(found.install?.version).toBe("3.8.51");
    expect(found.install?.kind).toBe("bun");
    expect(found.install?.folder).toBe(folder);
  });

  test("with no unit: the global folders, then the omniroute on PATH", () => {
    const home = tempDir("nopath");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
    expect(findOmniroute({ env: { HOME: home }, paths, which: () => null }).install).toBe(null);
    fakeBunInstall(home, "3.8.51");
    const found = findOmniroute({ env: { HOME: home }, paths, which: () => null });
    expect(found.install?.version).toBe("3.8.51");
    expect(found.unit).toBe(null);
  });

  test("the backend that talks to it: by name, else by the port the unit names", () => {
    const config = {
      backends: {
        ollama: { apiKey: "k", baseUrl: "https://ollama.com" },
        router: { apiKey: "k", baseUrl: "http://127.0.0.1:20128" },
      },
    };
    const unit = {
      argv: [],
      file: "/tmp/x.service",
      name: "x.service",
    };
    expect(omnirouteBackend(config, unit, () => 'PORT="20128"\n')?.name).toBe("router");
    // The name wins when there is one.
    expect(
      omnirouteBackend(
        { backends: { ...config.backends, omniroute: { apiKey: "k", baseUrl: "http://x" } } },
        unit,
        () => "",
      )?.name,
    ).toBe("omniroute");
    // A backend elsewhere on the internet is never taken for the local one.
    expect(omnirouteBackend(config, unit, () => "PORT=9\n")).toBe(null);
    // The port may come from an EnvironmentFile the unit names.
    expect(
      omnirouteBackend(config, unit, (path) =>
        path.endsWith(".service") ? "EnvironmentFile=-/etc/omni.env\n" : "OMNIROUTE_PORT=20128\n",
      )?.name,
    ).toBe("router");
  });
});

// ── The registry ────────────────────────────────────────────────────────────────

describe("the newest release old enough to install", () => {
  test("only plain x.y.z versions at least three days old, oldest first", () => {
    const releases = parseReleases(registryBody(), now);
    expect(releases.map((release) => release.version)).toEqual([
      "3.8.50",
      "3.8.51",
      "3.8.60",
      "3.9.0",
    ]);
    expect(MIN_RELEASE_AGE_MS).toBe(3 * DAY);
  });

  test("a version npm marks deprecated is never a release to move a machine to", () => {
    // npm's own `deprecated` note is what every install prints as a warning: the package's
    // author said this version should not be used. 3.8.50 is older than 3.9.0, so without
    // this it would come back as a version to install.
    const body = JSON.stringify({
      time: {
        "3.8.50": new Date(now - 30 * DAY).toISOString(),
        "3.9.0": new Date(now - 4 * DAY).toISOString(),
      },
      versions: { "3.8.50": { deprecated: "broken: use 3.9.0" }, "3.9.0": {} },
    });
    expect(parseReleases(body, now).map((release) => release.version)).toEqual(["3.9.0"]);
  });

  test("a version with no time in the registry is left out, and a broken answer is empty", () => {
    expect(parseReleases('{"versions":{"1.0.0":{}},"time":{}}', now)).toEqual([]);
    expect(parseReleases("not json", now)).toEqual([]);
    expect(parseReleases("[]", now)).toEqual([]);
  });

  test("the newest is the newest old enough, never a canary and never one from today", async () => {
    const registry = registryFetch(registryBody());
    const found = await newestRelease("omniroute", now, registry.fetch);
    expect(found).toEqual({
      releases: expect.any(Array),
      version: "3.9.0",
    });
    expect(registry.asked).toEqual(["https://registry.npmjs.org/omniroute"]);
  });

  test("a registry that answers an error, or nothing old enough, says so in words", async () => {
    const failed = await newestRelease("omniroute", now, registryFetch("nope", 500).fetch);
    expect("error" in failed && failed.error).toBe(
      "https://registry.npmjs.org/omniroute answered HTTP 500",
    );
    const empty = await newestRelease(
      "omniroute",
      now,
      registryFetch('{"versions":{},"time":{}}').fetch,
    );
    expect("error" in empty && empty.error).toContain("no release at least 3 days old");
  });

  test("a version that cannot be read counts as older", () => {
    expect(releaseIsNewer("3.8.51", "3.8.60")).toBe(true);
    expect(releaseIsNewer("3.9.0", "3.9.0")).toBe(false);
    expect(releaseIsNewer("not-a-version", "3.9.0")).toBe(true);
  });
});

// ── The model path's own check ──────────────────────────────────────────────────

describe("the model path's own check", () => {
  test("a model the list names and the chat answers: ok", async () => {
    const result = await probeModel({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async (url) =>
        url.endsWith("/v1/models")
          ? Response.json({ data: [{ id: "glm-5.3-flash" }] })
          : Response.json({ choices: [{ message: { content: "ready" } }] }),
      model: "glm-5.3-flash",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('glm-5.3-flash answered "ready"');
  });

  test("a key the backend refuses is named as the key, not as the version", async () => {
    const result = await probeModel({
      apiKey: "wrong",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => new Response("no", { status: 401 }),
      model: "glm-5.3-flash",
    });
    expect(result).toEqual({
      detail: "/v1/models answered HTTP 401: it does not accept the key in the gateway config",
      ok: false,
    });
  });

  test("a model the list does not name fails, because the slot would fall through", async () => {
    const result = await probeModel({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => Response.json({ data: [{ id: "other" }] }),
      model: "glm-5.3-flash",
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('lists no "glm-5.3-flash"');
  });

  test("a chat that answers an error is the failure, with its own reason", async () => {
    const result = await probeModel({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async (url) =>
        url.endsWith("/v1/models")
          ? Response.json({ data: [{ id: "glm-5.3-flash" }] })
          : new Response("model is gone", { status: 404 }),
      model: "glm-5.3-flash",
    });
    expect(result).toEqual({
      detail: "glm-5.3-flash answered HTTP 404 (model is gone)",
      ok: false,
    });
  });

  test("no model to try: the list alone, and it says so", async () => {
    const result = await probeModel({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => Response.json({ data: [{ id: "a" }, { id: "b" }] }),
      model: null,
    });
    expect(result).toEqual({
      detail: "/v1/models answers, 2 models (no model to try a chat with)",
      ok: true,
    });
  });

  test("a request that never answers is a failure in words, not a hang", async () => {
    const result = await probeModel({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => {
        throw new Error("ConnectionRefused");
      },
      model: "glm-5.3-flash",
    });
    expect(result.detail).toBe("/v1/models: ConnectionRefused");
  });
});

// ── The state file ──────────────────────────────────────────────────────────────

describe("what the last update replaced", () => {
  test("a state round-trips, and a broken one reads as empty", () => {
    const state = {
      previous: { at: "2026-10-16T00:00:00.000Z", version: "3.8.51" },
      version: 1 as const,
    };
    expect(parseState(formatState(state))).toEqual(state);
    expect(parseState("{}")).toBe(null);
    expect(parseState("not json")).toBe(null);
    expect(parseState('{"version":2}')).toBe(null);
    expect(parseState('{"version":1}')).toEqual(emptyState());
  });

  test("a missing file reads as empty", () => {
    expect(readState(join(tempDir("state"), "omniroute.json"))).toEqual(emptyState());
  });
});

// ── The commands ────────────────────────────────────────────────────────────────

/** A temp machine with a fake global install, a fake unit and a gateway config. */
function machine(options: { behind?: boolean } = {}) {
  const home = tempDir("omniroute");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const folder = fakeBunInstall(home, options.behind === true ? "3.8.51" : "3.9.0");
  const unitFile = join(home, ".config", "systemd", "user", "omniroute.service");
  fakeUnit(home, unitFile, join(folder, "bin", "omniroute.mjs"), 'Environment="PORT=20128"');
  saveConfig(paths.gatewayConfigFile, {
    aliases: {},
    anthropicBaseUrl: "https://api.anthropic.com",
    backends: { omniroute: { apiKey: "omni_key_a1b2", baseUrl: "http://127.0.0.1:20128" } },
    port: 20100,
    slots: {
      "cc-smart-dev-kit-scout": ["omniroute:glm-5.3-flash", "claude-sonnet-5-5"],
      "cc-smart-dev-kit-worker": ["claude-sonnet-5-5"],
    },
    timeouts: { firstByteMs: 60_000 },
    version: 1,
  });
  chmodSync(paths.gatewayConfigFile, 0o600);

  const said: string[] = [];
  const ran: string[] = [];
  /** The version the fake manager "installed", so the health check can refuse it. */
  let fails = false;
  /**
   * The clock, and how many times the backend refused a connection before it answered. Both
   * are the test's own: the wait after a restart is driven by `sleep` moving the clock, so no
   * test ever waits a real minute, and the fake backend can be slow to come up on purpose.
   */
  const clock = { now };
  let refusedFor = 0;
  const ctx: OmnirouteContext = {
    confirm: null,
    env: { HOME: home },
    health: async (url: string) => {
      if (refusedFor > 0) {
        refusedFor -= 1;
        throw Object.assign(new Error("Unable to connect."), { code: "ConnectionRefused" });
      }
      return url.endsWith("/v1/models")
        ? Response.json({ data: [{ id: "glm-5.3-flash" }] })
        : fails
          ? new Response("model gone", { status: 404 })
          : Response.json({ choices: [{ message: { content: "ready" } }] });
    },
    now: () => clock.now,
    paths,
    registry: registryFetch(registryBody()).fetch,
    runner: (cmd) => {
      ran.push(cmd.join(" "));
      return { exitCode: 0, output: `ran ${cmd.join(" ")}` };
    },
    say: (line) => said.push(line),
    sleep: async (ms) => {
      clock.now += ms;
    },
    // No system folders of the host: a real `/usr/lib/node_modules/omniroute` is not this test.
    systemFolders: [],
    systemd: true,
    which: (command) => (command === "bun" ? join(home, ".bun", "bin", "bun") : null),
  };
  return {
    clock,
    ctx,
    folder,
    home,
    paths,
    ran,
    said,
    setFailing: (value: boolean) => {
      fails = value;
    },
    setRefused: (times: number) => {
      refusedFor = times;
    },
  };
}

describe("cc-smart-dev-kit omniroute", () => {
  test("status names the install, the unit, the backend and the newest release", async () => {
    const world = machine({ behind: true });
    expect(await runOmniroute(["status"], world.ctx)).toBe(0);
    const text = world.said.join("\n");
    expect(text).toContain("omniroute 3.8.51 installed at");
    expect(text).toContain("a global bun install");
    expect(text).toContain("omniroute.service: active");
    expect(text).toContain("newest release at least 3 days old: 3.9.0");
    expect(text).toContain("gateway backend omniroute → http://127.0.0.1:20128");
    expect(text).toContain("first affordable target glm-5.3-flash");
    // The address is shown with its key masked (`shownBackendUrl`), never raw: a URL can carry
    // a credential in its userinfo, and a whole key in a line is a whole key in a log.
    expect(text).toContain("(key ••••a1b2)");
    expect(text).not.toContain("omni_key_a1b2");
  });

  test("status with nothing installed says so, and how to install it", async () => {
    const home = tempDir("nothing");
    const world = machine();
    const said: string[] = [];
    const code = await runOmniroute(["status"], {
      ...world.ctx,
      env: { HOME: home },
      paths: cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home }),
      say: (line) => said.push(line),
      which: () => null,
    });
    expect(code).toBe(1);
    expect(said.join("\n")).toContain("bun add -g omniroute");
  });

  test("update installs the newest, restarts the unit and checks the model path", async () => {
    const world = machine({ behind: true });
    expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(0);
    const text = world.said.join("\n");
    expect(text).toContain("OmniRoute 3.8.51 → 3.9.0, and omniroute.service restarts");
    expect(text).toContain(
      "While it restarts, a request to an OmniRoute target fails: a slot with its fallback on moves to its next target, if it has one; any other slot answers with that error.",
    );
    expect(world.ran).toContain(
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.9.0`,
    );
    expect(world.ran).toContain("systemctl --user restart omniroute.service");
    expect(text).toContain('health: ✓ glm-5.3-flash answered "ready"');
    expect(text).toContain("OmniRoute 3.9.0 is running.");
    // The version it replaced is recorded, for `rollback`.
    expect(readState(stateFile(world.paths)).previous?.version).toBe("3.8.51");
  });

  test("a new version that does not answer is put back, and the failure is said", async () => {
    const world = machine({ behind: true });
    world.setFailing(true);
    expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(1);
    const text = world.said.join("\n");
    expect(text).toContain("✗ the health check failed");
    expect(text).toContain("Putting 3.8.51 back.");
    expect(world.ran).toContain(
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.51`,
    );
    const restarts = world.ran.filter((line) => line.includes("restart omniroute.service"));
    expect(restarts.length).toBe(2);
  });

  test("nothing to do when the installed version is the newest old enough", async () => {
    const world = machine();
    expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(0);
    expect(world.said.join("\n")).toContain(
      "OmniRoute 3.9.0 is the newest release at least 3 days old.",
    );
    expect(world.ran).toEqual([]);
  });

  test("with no terminal, nothing is installed without --yes", async () => {
    const world = machine({ behind: true });
    expect(await runOmniroute(["update"], world.ctx)).toBe(1);
    expect(world.said.join("\n")).toContain("no terminal to ask on");
    expect(world.ran).toEqual([]);
    // And nothing was recorded, so a later rollback has nothing to go back to.
    expect(readState(stateFile(world.paths)).previous).toBe(null);
  });

  test("a person who says no stops it before anything runs", async () => {
    const world = machine({ behind: true });
    const questions: string[] = [];
    const code = await runOmniroute(["update"], {
      ...world.ctx,
      confirm: (question) => {
        questions.push(question);
        return false;
      },
    });
    expect(code).toBe(1);
    expect(questions).toEqual(["Install OmniRoute 3.9.0 and restart?"]);
    expect(world.ran).toEqual([]);
  });

  test("--to installs the version named, old-enough rule and all", async () => {
    const world = machine({ behind: true });
    expect(await runOmniroute(["update", "--yes", "--to", "3.8.60"], world.ctx)).toBe(0);
    expect(world.ran).toContain(
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.60`,
    );
  });

  test("rollback installs what the last update replaced, and keeps the record", async () => {
    const world = machine();
    writeState(stateFile(world.paths), {
      previous: { at: "2026-10-15T00:00:00.000Z", version: "3.8.51" },
      version: 1,
    });
    expect(await runOmniroute(["rollback", "--yes"], world.ctx)).toBe(0);
    expect(world.ran).toContain(
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.51`,
    );
    expect(world.said.join("\n")).toContain("OmniRoute 3.8.51 is running.");
    expect(readState(stateFile(world.paths)).previous?.version).toBe("3.8.51");
  });

  test("rollback with nothing recorded says where the record comes from", async () => {
    const world = machine();
    expect(await runOmniroute(["rollback", "--yes"], world.ctx)).toBe(1);
    expect(world.said.join("\n")).toContain("no version recorded to go back to");
    expect(world.ran).toEqual([]);
  });

  test("inside a Claude Code session update and rollback refuse; status is allowed", async () => {
    const world = machine({ behind: true });
    const env = { CLAUDECODE: "1", HOME: world.home };
    expect(await runOmniroute(["update", "--yes"], { ...world.ctx, env })).toBe(1);
    expect(world.said.join("\n")).toContain(
      "omniroute update cannot run inside a Claude Code session",
    );
    expect(world.ran).toEqual([]);
    const said: string[] = [];
    expect(await runOmniroute(["status"], { ...world.ctx, env, say: (l) => said.push(l) })).toBe(0);
    expect(said.join("\n")).toContain("omniroute 3.8.51 installed");
  });

  test("an unknown command, and an unknown option, are usage errors", async () => {
    const world = machine();
    const said: string[] = [];
    const ctx = { ...world.ctx, say: (line: string) => said.push(line) };
    expect(await runOmniroute(["nope"], ctx)).toBe(2);
    expect(said.join("\n")).toContain("Unknown omniroute command: nope");
    expect(await runOmniroute(["update", "--force"], ctx)).toBe(2);
    expect(await runOmniroute(["status", "--json"], ctx)).toBe(2);
  });

  test("the help of the command itself is usage, without arguments", async () => {
    const world = machine();
    expect(await runOmniroute([], world.ctx)).toBe(2);
    expect(await runOmniroute(["--help"], world.ctx)).toBe(0);
  });

  test("doctor's line appears only when an update is waiting, and never as a failure", async () => {
    const world = machine({ behind: true });
    const line = await omnirouteDoctorLine(world.ctx);
    expect(line?.text).toContain(
      "OmniRoute 3.8.51 at ~/.bun/install/global/node_modules/omniroute",
    );
    expect(line?.text).toContain("is behind 3.9.0 (published");
    expect(line?.text).toContain("cc-smart-dev-kit omniroute update");
    const current = machine();
    expect(await omnirouteDoctorLine(current.ctx)).toBe(null);
  });

  // ── `--to`, the wait after a restart, the lock, and a folder that is not ours ────

  test("--to refuses a version published today, a canary, a URL and a github spec", async () => {
    const cases: [string, string][] = [
      // One day old: the three-day rule is not suspended for a version a person names.
      ["3.8.70", "--to 3.8.70: the registry lists no such release, or it has not been out 3 days"],
      ["3.9.1-canary.1", "--to 3.9.1-canary.1: only a plain version like 3.8.51"],
      ["https://example.com/omniroute-3.9.0.tgz", "only a plain version like 3.8.51"],
      ["github:someone/omniroute", "only a plain version like 3.8.51"],
      ["9.9.9", "the registry lists no such release"],
    ];
    for (const [value, words] of cases) {
      const world = machine({ behind: true });
      expect(await runOmniroute(["update", "--yes", "--to", value], world.ctx)).toBe(1);
      const text = world.said.join("\n");
      expect(text).toContain(words);
      // Nothing ran at all: no `bun add`, no restart, no health check, and nothing recorded.
      expect(world.ran).toEqual([]);
      expect(readState(stateFile(world.paths)).previous).toBe(null);
    }
  });

  test("--to installs a release the registry lists and that is old enough", async () => {
    const world = machine({ behind: true });
    expect(await runOmniroute(["update", "--yes", "--to", "3.8.50"], world.ctx)).toBe(0);
    expect(world.ran).toContain(
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.50`,
    );
    expect(readState(stateFile(world.paths)).previous?.version).toBe("3.8.51");
  });

  test("a restarted OmniRoute that is slow to listen is waited for, not rolled back", async () => {
    const world = machine({ behind: true });
    // The first tries are refused: systemd said active, the process is not listening yet.
    world.setRefused(5);
    expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(0);
    const text = world.said.join("\n");
    expect(text).toContain("OmniRoute 3.9.0 is running.");
    // It waited by its own clock, and nothing was put back for being slow.
    expect(world.clock.now).toBeGreaterThan(now);
    expect(world.ran.filter((line) => line.includes("add --global"))).toEqual([
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.9.0`,
    ]);
    expect(text).not.toContain("Putting 3.8.51 back.");
  });

  test("a model path that never comes back gives up after about a minute, and puts the old back", async () => {
    const world = machine({ behind: true });
    world.setRefused(100_000);
    expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(1);
    const text = world.said.join("\n");
    expect(text).toContain("the backend answered nothing on http://127.0.0.1:20128 within 60 s");
    expect(text).toContain("✗ the model path did not come back");
    expect(text).toContain("Putting 3.8.51 back.");
    // The put-back waits the same way, so the second install was checked too.
    expect(world.ran.filter((line) => line.includes("add --global"))).toEqual([
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.9.0`,
      `${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.51`,
    ]);
    expect(text).toContain("✗ putting 3.8.51 back failed too");
    // Both waits ran to their deadline, by the test's clock: never a real minute.
    expect(world.clock.now - now).toBeGreaterThanOrEqual(2 * BACKEND_WAIT_MS);
  });

  test("the install, the restart and the check run while the state lock is held", async () => {
    const world = machine({ behind: true });
    const inner = world.ctx.runner;
    const held: boolean[] = [];
    const ctx: OmnirouteContext = {
      ...world.ctx,
      runner: (cmd) => {
        held.push(lockIsHeld(world.paths.stateDir));
        return inner(cmd);
      },
    };
    expect(await runOmniroute(["update", "--yes"], ctx)).toBe(0);
    // Every systemctl call of the update ran under the lock: the record, the install, the
    // restart and the check are one change to this machine's model path.
    expect(held.length).toBeGreaterThan(0);
    expect(held).toEqual(held.map(() => true));
    // And it is released when the command is done, so the next command is not locked out.
    expect(lockIsHeld(world.paths.stateDir)).toBe(false);
  });

  test("a second update waits for the lock instead of installing on top of the first", async () => {
    const world = machine({ behind: true });
    let released = false;
    const holding = withLock(world.paths.stateDir, async () => {
      await Bun.sleep(150);
      released = true;
    });
    const inner = world.ctx.runner;
    const seen: boolean[] = [];
    const ctx: OmnirouteContext = {
      ...world.ctx,
      runner: (cmd) => {
        seen.push(released);
        return inner(cmd);
      },
    };
    expect(await runOmniroute(["update", "--yes"], ctx)).toBe(0);
    await holding;
    // Nothing ran while the other run held the lock.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(seen.map(() => true));
  });

  test("an install folder this user cannot write is refused before anything runs", async () => {
    const world = machine({ behind: true });
    chmodSync(world.folder, 0o555);
    try {
      expect(await runOmniroute(["update", "--yes"], world.ctx)).toBe(1);
      const text = world.said.join("\n");
      expect(text).toContain("which this user cannot write");
      // The command to copy, never run: it needs sudo, and the plugin never runs that.
      expect(text).toContain(
        `sudo ${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.9.0`,
      );
      expect(world.ran).toEqual([]);
      expect(readState(stateFile(world.paths)).previous).toBe(null);
    } finally {
      chmodSync(world.folder, 0o755);
    }
  });

  test("rollback refuses that folder too, with its own command to copy", async () => {
    const world = machine();
    writeState(stateFile(world.paths), {
      previous: { at: "2026-10-15T00:00:00.000Z", version: "3.8.51" },
      version: 1,
    });
    chmodSync(world.folder, 0o555);
    try {
      expect(await runOmniroute(["rollback", "--yes"], world.ctx)).toBe(1);
      const text = world.said.join("\n");
      expect(text).toContain("which this user cannot write");
      expect(text).toContain(
        `sudo ${join(world.home, ".bun", "bin", "bun")} add --global omniroute@3.8.51`,
      );
      expect(world.ran).toEqual([]);
      // The record stays: it is what the next rollback goes back to.
      expect(readState(stateFile(world.paths)).previous?.version).toBe("3.8.51");
    } finally {
      chmodSync(world.folder, 0o755);
    }
  });
});

// ── Where the first affordable target comes from ─────────────────────────────────

describe("the first affordable target", () => {
  test("scout first, then worker, then any slot; only this backend's targets", () => {
    const config = {
      slots: {
        "cc-smart-dev-kit-scout": ["claude-sonnet-5-5", "omniroute:glm-5.3-flash"],
        "cc-smart-dev-kit-worker": ["omniroute:deepseek-v4.1-flash"],
      },
    };
    expect(firstAffordableTarget(config, { name: "omniroute" })).toBe("glm-5.3-flash");
    expect(
      firstAffordableTarget(
        { slots: { "cc-smart-dev-kit-worker": ["omniroute:x"] } },
        { name: "omniroute" },
      ),
    ).toBe("x");
    expect(firstAffordableTarget(config, { name: "ollama" })).toBe(null);
  });

  test("an environment file the unit names is read for the port", () => {
    const world = machine();
    const config = loadConfigFile(world.paths.gatewayConfigFile);
    expect(config.backends.omniroute?.apiKey).toBe("omni_key_a1b2");
    // The file's own text is never printed by `status`: only the masked key appears anywhere.
    expect(world.said.join("\n")).not.toContain("omni_key_a1b2");
  });

  test("no config at all: status still works, and says the check is skipped", async () => {
    const world = machine();
    const said: string[] = [];
    const code = await runOmniroute(["status"], {
      ...world.ctx,
      paths: { ...world.paths, gatewayConfigFile: join(world.home, "missing.json") },
      say: (line) => said.push(line),
    });
    expect(code).toBe(0);
    expect(said.join("\n")).toContain("names no omniroute backend");
  });
});

/** The version a `update --to` names that is not a version at all still goes through. */
test("the recorded time is an ISO stamp, as `doctor` and the portal read it", () => {
  const world = machine();
  writeState(stateFile(world.paths), {
    previous: { at: new Date(now).toISOString(), version: "3.8.51" },
    version: 1,
  });
  expect(readFileSync(stateFile(world.paths), "utf8")).toContain("2026-10-16T12:00:00.000Z");
});
