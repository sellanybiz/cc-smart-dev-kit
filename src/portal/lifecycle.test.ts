/**
 * The portal's life without a real port: the health probe, the start, restart and stop
 * decisions, the copy, and the session-start part. Every probe, spawn and kill is a recorder,
 * so nothing here starts a server, touches a real port or signals a real process.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { detachedArgv } from "../hooks/detached";
import { readOwnedFolders } from "../setup/managed-folder";
import { restore } from "../setup/restore";
import { readChanged } from "../setup/write";
import { tempDir } from "../testing/temp";
import {
  PORTAL_APP,
  PORTAL_HEALTH_PATH,
  type PortalProbe,
  type PortalState,
  probePortal,
  readHealth,
  waitForPortal,
} from "./health";
import {
  ensurePortal,
  noteHeldPortOnce,
  portalLog,
  portalOutdated,
  portalServerArgv,
  portalStarterArgv,
  portalStatusLine,
  refreshPortalCopy,
  stopPortal,
} from "./lifecycle";
import { portalStartsAtSessionStart, startPortalAtSessionStart } from "./session-start";

const INSTALLED = "1.1.0";

/** A temp home, a plugin folder with a portal bundle in it, and its paths. */
function world(options: { ui?: boolean } = {}) {
  const home = tempDir("portal-life");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const pluginFolder = join(home, "plugin");
  mkdirSync(join(pluginFolder, "dist"), { recursive: true });
  writeFileSync(join(pluginFolder, "dist", "portal.js"), "// the portal bundle\n");
  if (options.ui === true) {
    mkdirSync(join(pluginFolder, "portal-ui", "_next", "static"), { recursive: true });
    writeFileSync(join(pluginFolder, "portal-ui", "index.html"), "<html>exported</html>\n");
    writeFileSync(join(pluginFolder, "portal-ui", "_next", "static", "main.js"), "// js\n");
  }
  return { home, paths, pluginFolder };
}

/** A portal state the fakes move through, as a real start or stop would. */
interface Life {
  afterKill: PortalState;
  afterStart: PortalState;
  state: PortalState;
}

/**
 * The probe's fakes: the fetch answers the state the test's world is in, `now` moves forward
 * on every look (so a wait ends), and `sleep` does nothing.
 */
function fakeProbe(life: Life): PortalProbe {
  let clock = 0;
  return {
    fetch: async (url) => {
      expect(String(url)).toBe(`http://127.0.0.1:20150${PORTAL_HEALTH_PATH}`);
      const state = life.state;
      if (state.kind === "free") {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:20150") as Error & {
          code?: string;
        };
        error.code = "ConnectionRefused";
        throw error;
      }
      if (state.kind === "other") return new Response("not here", { status: 404 });
      return Response.json({
        app: PORTAL_APP,
        ok: true,
        pid: state.pid,
        version: state.version,
      });
    },
    now: () => (clock += 100),
    sleep: async () => undefined,
  };
}

/** The life a world starts in, and what a start or a kill does to it. */
function life(state: PortalState, after: { kill?: PortalState; start?: PortalState }): Life {
  return {
    afterKill: after.kill ?? { kind: "free" },
    afterStart: after.start ?? { kind: "ours", pid: 4321, version: INSTALLED },
    state,
  };
}

function deps(options: {
  life: Life;
  pluginFolder: string;
  paths: ReturnType<typeof world>["paths"];
}) {
  const spawned: string[][] = [];
  const killed: number[] = [];
  const lines: string[] = [];
  const spawn = (argv: string[]) => {
    spawned.push(argv);
    options.life.state = options.life.afterStart;
  };
  return {
    killed,
    lines,
    run: () =>
      ensurePortal({
        bunPath: "/opt/bun/bin/bun",
        kill: (pid) => {
          killed.push(pid);
          options.life.state = options.life.afterKill;
        },
        log: (line) => lines.push(line),
        paths: options.paths,
        pluginFolder: options.pluginFolder,
        port: 20150,
        probe: fakeProbe(options.life),
        spawn,
        version: INSTALLED,
      }),
    spawned,
  };
}

describe("the health answer", () => {
  test("ours carries the portal's name, its pid and its version; anything else is not ours", () => {
    expect(readHealth({ app: PORTAL_APP, ok: true, pid: 7, version: "1.1.0" })).toEqual({
      pid: 7,
      version: "1.1.0",
    });
    for (const body of [
      null,
      [],
      {},
      { app: "another-program", ok: true, pid: 7, version: "1.1.0" },
      { app: PORTAL_APP, ok: false, pid: 7, version: "1.1.0" },
      { app: PORTAL_APP, ok: true, pid: 0, version: "1.1.0" },
      { app: PORTAL_APP, ok: true, pid: 7, version: "" },
      { app: PORTAL_APP, ok: true, version: "1.1.0" },
    ]) {
      expect(readHealth(body)).toBe(null);
    }
  });

  test("the probe: ours, another program's answer, and nothing listening", async () => {
    const life1 = life({ kind: "ours", pid: 12, version: "1.1.0" }, {});
    expect(await probePortal(20150, fakeProbe(life1))).toEqual({
      kind: "ours",
      pid: 12,
      version: "1.1.0",
    });
    const life2 = life({ kind: "other" }, {});
    expect(await probePortal(20150, fakeProbe(life2))).toEqual({ kind: "other" });
    const life3 = life({ kind: "free" }, {});
    expect(await probePortal(20150, fakeProbe(life3))).toEqual({ kind: "free" });
  });

  test("a timeout, and a program that answers with something else, are both 'other'", async () => {
    const timeout: PortalProbe = {
      fetch: async () => {
        throw new Error("The operation timed out.");
      },
      now: () => 0,
      sleep: async () => undefined,
    };
    expect(await probePortal(20150, timeout)).toEqual({ kind: "other" });
    const wrong: PortalProbe = {
      fetch: async () => Response.json({ hello: "world" }),
      now: () => 0,
      sleep: async () => undefined,
    };
    expect(await probePortal(20150, wrong)).toEqual({ kind: "other" });
  });

  test("waiting for the port looks again until it changes", async () => {
    let looks = 0;
    let clock = 0;
    const probe: PortalProbe = {
      fetch: async () => {
        looks += 1;
        if (looks === 1) {
          const error = new Error("refused") as Error & { code?: string };
          error.code = "ConnectionRefused";
          throw error;
        }
        return Response.json({ app: PORTAL_APP, ok: true, pid: 3, version: "1.1.0" });
      },
      now: () => (clock += 100),
      sleep: async () => undefined,
    };
    expect(await waitForPortal(20150, probe, "ours", 1_000)).toEqual({
      kind: "ours",
      pid: 3,
      version: "1.1.0",
    });
    expect(looks).toBe(2);
  });
});

describe("the copy", () => {
  test("it is written from the installed bundle through the managed file, once", () => {
    const { paths, pluginFolder } = world();
    const first = refreshPortalCopy(paths, pluginFolder);
    expect(first).toEqual({ copy: paths.portalCopy });
    expect(readFileSync(paths.portalCopy, "utf8")).toBe("// the portal bundle\n");
    // A managed file: `restore` finds it and removes it.
    expect(readChanged(paths.stateDir)[paths.portalCopy]?.kinds).toEqual(["whole-file"]);
    const before = readFileSync(paths.portalCopy, "utf8");
    refreshPortalCopy(paths, pluginFolder);
    expect(readFileSync(paths.portalCopy, "utf8")).toBe(before);
  });

  test("a missing bundle is a reason in words, and nothing is written", () => {
    const { paths } = world();
    const empty = join(paths.home, "no-plugin");
    mkdirSync(empty, { recursive: true });
    const result = refreshPortalCopy(paths, empty);
    expect("error" in result && result.error).toContain("the portal bundle is missing");
    expect(existsSync(paths.portalCopy)).toBe(false);
  });

  test("the export beside the bundle is copied as an owned folder, and restore removes it", () => {
    const { paths, pluginFolder } = world({ ui: true });
    expect(refreshPortalCopy(paths, pluginFolder)).toEqual({ copy: paths.portalCopy });
    expect(readFileSync(join(paths.portalUiFolder, "index.html"), "utf8")).toBe(
      "<html>exported</html>\n",
    );
    expect(readFileSync(join(paths.portalUiFolder, "_next", "static", "main.js"), "utf8")).toBe(
      "// js\n",
    );
    expect(readOwnedFolders(paths.stateDir)).toEqual([paths.portalUiFolder]);
    // The export is build output: restore removes it whole, and the bundle copy with it.
    const results = restore(paths.stateDir);
    expect(existsSync(paths.portalUiFolder)).toBe(false);
    expect(existsSync(paths.portalCopy)).toBe(false);
    expect(results.map((result) => [result.file, result.action])).toEqual([
      [paths.portalCopy, "removed"],
      [paths.portalUiFolder, "removed"],
    ]);
  });

  test("an export that changed replaces the copy; a version with no export removes it", () => {
    const { paths, pluginFolder } = world({ ui: true });
    refreshPortalCopy(paths, pluginFolder);
    writeFileSync(join(pluginFolder, "portal-ui", "index.html"), "<html>next</html>\n");
    refreshPortalCopy(paths, pluginFolder);
    expect(readFileSync(join(paths.portalUiFolder, "index.html"), "utf8")).toBe(
      "<html>next</html>\n",
    );
    // An older install ships no export: the copy's export goes, so new pages are never served
    // with an older bundle.
    rmSync(join(pluginFolder, "portal-ui"), { recursive: true, force: true });
    expect(refreshPortalCopy(paths, pluginFolder)).toEqual({ copy: paths.portalCopy });
    expect(existsSync(paths.portalUiFolder)).toBe(false);
    expect(readOwnedFolders(paths.stateDir)).toEqual([]);
  });
});

describe("the start decision", () => {
  test("nothing answers: the server is started from the copy", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({ life: life({ kind: "free" }, {}), paths, pluginFolder });
    expect(await machine.run()).toEqual({ kind: "started", pid: 4321, version: INSTALLED });
    expect(machine.spawned).toEqual([
      portalServerArgv("/opt/bun/bin/bun", paths.portalCopy, pluginFolder),
    ]);
    expect(machine.killed).toEqual([]);
    expect(machine.lines.join("\n")).toContain("started: version 1.1.0, pid 4321");
  });

  test("our own version answers: nothing is started and nothing is killed", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({
      life: life({ kind: "ours", pid: 99, version: INSTALLED }, {}),
      paths,
      pluginFolder,
    });
    expect(await machine.run()).toEqual({ kind: "running", pid: 99, version: INSTALLED });
    expect(machine.spawned).toEqual([]);
    expect(machine.killed).toEqual([]);
  });

  test("an older version answers: it is stopped by the pid that answered, and this version starts", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({
      life: life({ kind: "ours", pid: 41, version: "1.0.0" }, {}),
      paths,
      pluginFolder,
    });
    expect(await machine.run()).toEqual({
      kind: "restarted",
      from: "1.0.0",
      pid: 4321,
      to: INSTALLED,
    });
    expect(machine.killed).toEqual([41]);
    expect(machine.spawned).toHaveLength(1);
  });

  test("a newer version answers: an older install never replaces it (D10's one-way rule)", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({
      life: life({ kind: "ours", pid: 5, version: "2.0.0" }, {}),
      paths,
      pluginFolder,
    });
    expect(await machine.run()).toEqual({ kind: "running", pid: 5, version: "2.0.0" });
    expect(machine.spawned).toEqual([]);
    expect(machine.killed).toEqual([]);
    expect(machine.lines.join("\n")).toContain("newer than the installed 1.1.0");
    expect(portalOutdated("1.1.0", "2.0.0")).toBe(false);
    expect(portalOutdated("1.1.0", "1.0.0")).toBe(true);
    expect(portalOutdated("1.1.0", "1.1.0")).toBe(false);
  });

  test("another program holds the port: nothing is started, and the line is written once", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({ life: life({ kind: "other" }, {}), paths, pluginFolder });
    expect(await machine.run()).toEqual({ kind: "other" });
    expect(machine.spawned).toEqual([]);
    expect(machine.killed).toEqual([]);
    expect(machine.lines.filter((line) => line.includes("held by another program"))).toHaveLength(
      1,
    );
    // A second session start says nothing new: the marker remembers the port.
    const second = deps({ life: life({ kind: "other" }, {}), paths, pluginFolder });
    expect(await second.run()).toEqual({ kind: "other" });
    expect(second.lines.join("\n")).not.toContain("held by another program");
    // When the portal does start, the marker is forgotten: the next hold is news again.
    const third = deps({ life: life({ kind: "free" }, {}), paths, pluginFolder });
    await third.run();
    expect(noteHeldPortOnce(paths, 20150, Date.now())).toBe(true);
  });

  test("the state folder follows CLAUDE_CONFIG_DIR, never a second folder under HOME", async () => {
    // A session may carry its own config folder. The portal started from it writes its log, its
    // held-port marker and its lock under that folder's state (`cliPaths().stateDir`), and never
    // computes a second one from HOME.
    const home = tempDir("portal-home");
    const config = tempDir("portal-config");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: config, HOME: home });
    const pluginFolder = join(home, "plugin");
    mkdirSync(join(pluginFolder, "dist"), { recursive: true });
    writeFileSync(join(pluginFolder, "dist", "portal.js"), "// the portal bundle\n");

    const outcome = await ensurePortal({
      bunPath: "/opt/bun/bin/bun",
      kill: () => undefined,
      // The portal's own log, as the entry gives it: the file in the state folder.
      log: (line) => portalLog(paths, line),
      paths,
      pluginFolder,
      port: 20150,
      probe: fakeProbe(life({ kind: "other" }, {})),
      spawn: () => undefined,
      version: INSTALLED,
    });
    expect(outcome).toEqual({ kind: "other" });

    const stateFolder = join(config, "cc-smart-dev-kit");
    expect(readFileSync(join(stateFolder, "portal.log"), "utf8")).toContain(
      "port 20150 is held by another program",
    );
    expect(existsSync(join(stateFolder, "portal-held.json"))).toBe(true);
    // Not under HOME: the config folder is this session's, and the portal follows it.
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  test("a portal that does not answer after the start is a failure, with the reason", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({
      life: life({ kind: "free" }, { start: { kind: "free" } }),
      paths,
      pluginFolder,
    });
    const outcome = await machine.run();
    expect(outcome.kind).toBe("failed");
    expect("reason" in outcome && outcome.reason).toContain("did not answer");
  });

  test("an old portal that will not stop is left running, and this version does not start", async () => {
    const { paths, pluginFolder } = world();
    const machine = deps({
      life: life(
        { kind: "ours", pid: 77, version: "1.0.0" },
        {
          kill: { kind: "ours", pid: 77, version: "1.0.0" },
        },
      ),
      paths,
      pluginFolder,
    });
    const outcome = await machine.run();
    expect(outcome.kind).toBe("failed");
    expect("reason" in outcome && outcome.reason).toContain("did not stop");
    expect(machine.spawned).toEqual([]);
  });
});

describe("the stop", () => {
  function stopWorld(state: PortalState, afterKill: PortalState = { kind: "free" }) {
    const life1 = life(state, { kill: afterKill });
    const killed: number[] = [];
    const lines: string[] = [];
    return {
      killed,
      lines,
      run: () =>
        stopPortal({
          kill: (pid) => {
            killed.push(pid);
            life1.state = afterKill;
          },
          log: (line) => lines.push(line),
          paths: world().paths,
          port: 20150,
          probe: fakeProbe(life1),
        }),
    };
  }

  test("our portal: stopped by its pid, and the port is free after", async () => {
    const machine = stopWorld({ kind: "ours", pid: 8, version: "1.1.0" });
    expect(await machine.run()).toEqual({ kind: "stopped" });
    expect(machine.killed).toEqual([8]);
  });

  test("nothing runs: nothing is killed", async () => {
    const machine = stopWorld({ kind: "free" });
    expect(await machine.run()).toEqual({ kind: "not-running" });
    expect(machine.killed).toEqual([]);
  });

  test("another program holds the port: it is never signalled", async () => {
    const machine = stopWorld({ kind: "other" });
    expect(await machine.run()).toEqual({ kind: "other" });
    expect(machine.killed).toEqual([]);
  });

  test("a portal that does not stop in time is a failure", async () => {
    const machine = stopWorld(
      { kind: "ours", pid: 8, version: "1.1.0" },
      {
        kind: "ours",
        pid: 8,
        version: "1.1.0",
      },
    );
    const outcome = await machine.run();
    expect(outcome.kind).toBe("failed");
  });
});

describe("the status line", () => {
  test("each of the four answers, in words that name what to do", () => {
    expect(portalStatusLine({ kind: "ours", pid: 3, version: "1.1.0" }, "1.1.0")).toBe(
      "The portal is running at http://127.0.0.1:20150 (version 1.1.0, process 3).",
    );
    expect(portalStatusLine({ kind: "ours", pid: 3, version: "1.0.0" }, "1.1.0")).toContain(
      "the next Claude Code session restarts it onto 1.1.0",
    );
    expect(portalStatusLine({ kind: "ours", pid: 3, version: "2.0.0" }, "1.1.0")).toContain(
      "newer than the installed 1.1.0",
    );
    expect(portalStatusLine({ kind: "free" }, "1.1.0")).toContain("is not running");
    expect(portalStatusLine({ kind: "other" }, "1.1.0")).toContain("Another program holds");
  });
});

describe("the session-start part", () => {
  const env = { HOME: "/home/user" };

  test("an interactive startup or resume starts it; claude -p and a clear do not", () => {
    expect(portalStartsAtSessionStart(env, "startup")).toBe(true);
    expect(portalStartsAtSessionStart(env, "resume")).toBe(true);
    expect(portalStartsAtSessionStart(env, null)).toBe(true);
    expect(
      portalStartsAtSessionStart({ ...env, CLAUDE_CODE_SESSION_ATTENDED: "0" }, "startup"),
    ).toBe(false);
    expect(portalStartsAtSessionStart(env, "clear")).toBe(false);
    expect(portalStartsAtSessionStart(env, "compact")).toBe(false);
  });

  test("it starts the installed bundle's starter, detached, with the home as its folder", () => {
    const installedFolder = join(tempDir("portal-installed"), "1.1.0");
    mkdirSync(join(installedFolder, "dist"), { recursive: true });
    writeFileSync(join(installedFolder, "dist", "portal.js"), "// the installed bundle\n");
    const spawned: { argv: string[]; options: { cwd: string; env: Record<string, string> } }[] = [];
    const reason = startPortalAtSessionStart({
      bunPath: "/opt/bun/bin/bun",
      env,
      installed: { folder: installedFolder },
      runIn: { cwd: "/home/user", env: { HOME: "/home/user" } },
      source: "startup",
      spawn: (argv, options) => spawned.push({ argv, options }),
    });
    expect(reason).toBe("started");
    expect(spawned).toEqual([
      {
        argv: [
          "/opt/bun/bin/bun",
          "--no-env-file",
          `--config=${installedFolder}/bunfig.toml`,
          `${installedFolder}/dist/portal.js`,
          "--ensure",
        ],
        options: { cwd: "/home/user", env: { HOME: "/home/user" } },
      },
    ]);
  });

  test("nothing when there is no bundle, no person, or not a session start", () => {
    const spawned: string[][] = [];
    const run = (options: {
      env?: Record<string, string>;
      installed: null | { folder: string };
      source?: null | string;
    }) =>
      startPortalAtSessionStart({
        bunPath: "/opt/bun/bin/bun",
        env: options.env ?? env,
        installed: options.installed,
        runIn: { cwd: "/home/user", env: {} },
        source: options.source === undefined ? "startup" : options.source,
        spawn: (argv) => spawned.push(argv),
      });
    expect(run({ installed: null })).toBe("no-bundle");
    // A record whose folder has no bundle (a half install): nothing starts.
    expect(run({ installed: { folder: "/plugins/missing" } })).toBe("no-bundle");
    expect(run({ env: { CLAUDE_CODE_SESSION_ATTENDED: "0" }, installed: { folder: "/p" } })).toBe(
      "unattended",
    );
    expect(run({ installed: { folder: "/p" }, source: "compact" })).toBe("not-a-start");
    expect(spawned).toEqual([]);
  });
});

describe("Windows: the detached start has no console window", () => {
  test("the server and the starter go through the cmd /c start trampoline", () => {
    // `startDetached` waits for the trampoline itself (it returns at once) and starts it with
    // `windowsHide: true`, so cmd and the program it starts have no console window. What is
    // checked here is that both portal run lines really go through it.
    const server = detachedArgv(
      "win32",
      portalServerArgv("C:\\bun\\bun.exe", "C:\\data\\portal.js", "C:\\p"),
    );
    expect(server[0]).toBe("cmd");
    expect(server.slice(1, 5)).toEqual(["/d", "/s", "/v:off", "/c"]);
    expect(server[5]).toContain('start "" /b ');
    expect(server[5]).toContain('"C:\\data\\portal.js"');
    const starter = detachedArgv(
      "win32",
      portalStarterArgv("C:\\bun\\bun.exe", "C:\\p\\dist\\portal.js", "C:\\p"),
    );
    expect(starter[0]).toBe("cmd");
    expect(starter[5]).toContain('start "" /b ');
    expect(starter[5]).toContain('"--ensure"');
  });
});
