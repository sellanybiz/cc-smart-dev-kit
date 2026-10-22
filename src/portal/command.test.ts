/**
 * `cc-smart-dev-kit portal`, `portal status` and `portal stop`: the options, the words, the
 * exit codes, and the copy the portal runs from. No server starts and no port is touched: the
 * probe, the detached start and the kill are recorders.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, VERSION } from "../build-info";
import { cliPaths } from "../cli/paths";
import type { Machine } from "../machine/machine";
import { DEFAULT_PORTAL_PORT } from "../ports";
import { readChanged } from "../setup/write";
import { tempDir } from "../testing/temp";
import {
  installedPluginFolder,
  mayAutoOpen,
  openYourselfLine,
  PORTAL_USAGE,
  parsePortalArgs,
  parsePortalChildArgs,
  portalCopy,
  runPortal,
} from "./command";
import { PORTAL_APP, PORTAL_HEALTH_PATH, type PortalProbe, type PortalState } from "./health";
import { portalServerArgv, portalStarterArgv } from "./lifecycle";

const PORT = DEFAULT_PORTAL_PORT;

/** A portal state the fakes move through, as a real start or stop would. */
interface Life {
  state: PortalState;
}

/** The probe's fakes: the fetch answers the state the world is in, and the clock moves along. */
function fakeProbe(life: Life): PortalProbe {
  let clock = 0;
  return {
    fetch: async (url) => {
      expect(String(url)).toBe(`http://127.0.0.1:${PORT}${PORTAL_HEALTH_PATH}`);
      const state = life.state;
      if (state.kind === "free") {
        const error = new Error("connect ECONNREFUSED") as Error & { code?: string };
        error.code = "ConnectionRefused";
        throw error;
      }
      if (state.kind === "other") return new Response("no", { status: 404 });
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

/** A temp home, a plugin folder with a bundle, and recorders for everything the command does. */
function world(options: { bundle?: boolean; startGives?: PortalState; state?: PortalState } = {}) {
  const home = tempDir("portal-command");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const pluginDir = join(home, "plugin");
  mkdirSync(join(pluginDir, "dist"), { recursive: true });
  if (options.bundle !== false) {
    writeFileSync(join(pluginDir, "dist", "portal.js"), "// the portal bundle\n");
  }
  const life: Life = { state: options.state ?? { kind: "free" } };
  const spawned: string[][] = [];
  const opened: string[][] = [];
  const killed: number[] = [];
  const printed: string[] = [];
  const errors: string[] = [];
  const machine: Machine = {
    arch: "x64",
    confirm: null,
    exists: () => false,
    fetchText: async () => "",
    macApp: "/Applications/Warp.app",
    osRelease: () => null,
    platform: "linux",
    run: () => ({ exitCode: 0, output: "" }),
    runOnTerminal: () => 0,
    spawnDetached: (argv) => opened.push(argv),
    which: (name) => (name === "xdg-open" || name === "open" ? `/usr/bin/${name}` : null),
  };
  return {
    errors,
    home,
    killed,
    life,
    machine,
    opened,
    paths,
    pluginDir,
    printed,
    run: (args: readonly string[] = []) =>
      runPortal(
        {
          bunPath: "/opt/bun/bin/bun",
          env: { HOME: home },
          error: (line) => errors.push(line),
          kill: (pid) => {
            killed.push(pid);
            life.state = { kind: "free" };
          },
          machine,
          paths,
          pluginDir,
          port: PORT,
          print: (line) => printed.push(line),
          probe: fakeProbe(life),
          spawn: (argv) => {
            spawned.push(argv);
            life.state = options.startGives ?? { kind: "ours", pid: 4321, version: VERSION };
          },
        },
        args,
      ),
    spawned,
  };
}

describe("the options", () => {
  test("the default is open; status and stop are the two commands; --no-open is a switch", () => {
    expect(parsePortalArgs([])).toEqual({ command: "open", noOpen: false });
    expect(parsePortalArgs(["status"])).toEqual({ command: "status", noOpen: false });
    expect(parsePortalArgs(["stop", "--no-open"])).toEqual({ command: "stop", noOpen: true });
    expect(parsePortalArgs(["status", "stop"])).toEqual({
      error: "one command at a time: status or stop",
    });
    // The fixed port (D10): neither the person nor an old link can move it.
    expect(parsePortalArgs(["--port", "9999"])).toEqual({ error: "Unknown option: --port" });
    expect(parsePortalArgs(["--plugin-dir", "/tmp/elsewhere"])).toEqual({
      error: "Unknown option: --plugin-dir",
    });
  });

  test("the bundle's own options: the starter, the server, and the parent's folder", () => {
    expect(parsePortalChildArgs([])).toEqual({
      ensure: false,
      noOpen: false,
      pluginDir: null,
      serve: false,
    });
    expect(parsePortalChildArgs(["--serve", "--plugin-dir", "/p"])).toEqual({
      ensure: false,
      noOpen: false,
      pluginDir: "/p",
      serve: true,
    });
    expect(parsePortalChildArgs(["--ensure"])).toEqual({
      ensure: true,
      noOpen: false,
      pluginDir: null,
      serve: false,
    });
    expect(parsePortalChildArgs(["--ensure", "--serve"])).toEqual({
      error: "--ensure and --serve are two different runs",
    });
    expect(parsePortalChildArgs(["--plugin-dir"])).toEqual({
      error: "--plugin-dir needs a folder",
    });
    expect(parsePortalChildArgs(["--port", "1"])).toEqual({ error: "Unknown option: --port" });
  });

  test("a wrong option is exit 2 with the usage, and nothing is copied or started", async () => {
    const machine = world();
    expect(await machine.run(["--nope"])).toBe(2);
    expect(machine.errors.join("\n")).toContain("Unknown option: --nope");
    expect(machine.errors.join("\n")).toContain(`Usage: ${COMMAND} portal`);
    expect(machine.spawned).toEqual([]);
    expect(existsSync(portalCopy(machine.paths))).toBe(false);
    expect(PORTAL_USAGE).toContain("status");
    expect(PORTAL_USAGE).toContain("stays up until you stop it");
  });
});

describe("portal", () => {
  test("nothing answers: the copy is written and the server started from it, then the page opens", async () => {
    const machine = world();
    expect(await machine.run()).toBe(0);
    expect(readFileSync(portalCopy(machine.paths), "utf8")).toBe("// the portal bundle\n");
    // It is a managed file: `restore` finds it and removes it.
    expect(readChanged(machine.paths.stateDir)[portalCopy(machine.paths)]?.kinds).toEqual([
      "whole-file",
    ]);
    expect(machine.spawned).toEqual([
      portalServerArgv("/opt/bun/bin/bun", portalCopy(machine.paths), machine.pluginDir),
    ]);
    expect(machine.printed).toEqual([
      `The portal was not running: started it (version ${VERSION}).`,
      `  http://127.0.0.1:${PORT}/`,
    ]);
    // The person's own browser, through the one home for that (`open-url.ts`).
    expect(machine.opened).toEqual([["xdg-open", `http://127.0.0.1:${PORT}/`]]);
  });

  test("it already runs this version: nothing starts, and the page opens", async () => {
    const machine = world({ state: { kind: "ours", pid: 99, version: VERSION } });
    expect(await machine.run()).toBe(0);
    expect(machine.spawned).toEqual([]);
    expect(machine.killed).toEqual([]);
    expect(machine.printed[0]).toBe(`The portal is running (version ${VERSION}).`);
  });

  test("an older version answers: it is stopped and restarted onto this one", async () => {
    const machine = world({ state: { kind: "ours", pid: 41, version: "0.6.0" } });
    expect(await machine.run()).toBe(0);
    expect(machine.killed).toEqual([41]);
    expect(machine.spawned).toHaveLength(1);
    expect(machine.printed[0]).toContain(
      `The portal was running 0.6.0: restarted it onto ${VERSION}`,
    );
  });

  test("a newer version answers: an older install leaves it alone", async () => {
    const machine = world({ state: { kind: "ours", pid: 5, version: "9.9.9" } });
    expect(await machine.run()).toBe(0);
    expect(machine.spawned).toEqual([]);
    expect(machine.killed).toEqual([]);
    expect(machine.printed[0]).toContain("The portal is running (version 9.9.9).");
  });

  test("another program holds the port: one line, nothing started, exit 1", async () => {
    const machine = world({ state: { kind: "other" } });
    expect(await machine.run()).toBe(1);
    expect(machine.spawned).toEqual([]);
    expect(machine.errors.join("\n")).toContain(
      `Another program holds 127.0.0.1:${PORT}, so the portal cannot start`,
    );
  });

  test("a missing bundle stops before anything starts, and names the install", async () => {
    const machine = world({ bundle: false });
    expect(await machine.run()).toBe(1);
    expect(machine.spawned).toEqual([]);
    expect(machine.errors.join("\n")).toContain("the portal bundle is missing");
    expect(existsSync(portalCopy(machine.paths))).toBe(false);
  });

  test("a start that never answers is a failure, and the log is named", async () => {
    const machine = world({ startGives: { kind: "free" } });
    expect(await machine.run()).toBe(1);
    expect(machine.errors.join("\n")).toContain("did not answer");
    expect(machine.errors.join("\n")).toContain(machine.paths.portalLogFile);
    // The log holds the same reason, for a start the person never saw.
    expect(readFileSync(machine.paths.portalLogFile, "utf8")).toContain(
      "failed: the portal did not answer",
    );
  });

  test("--no-open prints the address and opens nothing", async () => {
    const machine = world();
    expect(await machine.run(["--no-open"])).toBe(0);
    expect(machine.opened).toEqual([]);
    expect(machine.printed).toContain(`  http://127.0.0.1:${PORT}/`);
  });

  test("the browser decision: never in the profile Claude Code drives", () => {
    expect(mayAutoOpen({ claudeCodeProfile: false, noOpen: false })).toBe(true);
    expect(mayAutoOpen({ claudeCodeProfile: true, noOpen: false })).toBe(false);
    expect(mayAutoOpen({ claudeCodeProfile: false, noOpen: true })).toBe(false);
    expect(mayAutoOpen({ claudeCodeProfile: true, noOpen: true })).toBe(false);
    expect(openYourselfLine()).toContain('"claude-code"');
    expect(openYourselfLine()).toContain("NOT that profile");
  });

  test("the entry asks that decision, with the profile it really has, before opening", () => {
    // The entry starts a server and waits, so it cannot be imported here: this reads it, for
    // the three pieces the decision is made of — the profile read, the decision, the line.
    const source = readFileSync(join(import.meta.dir, "..", "entries", "portal.ts"), "utf8");
    expect(source).toContain("claudeCodeProfileHere(machine, paths.home)");
    expect(source).toContain(
      "mayAutoOpen({ claudeCodeProfile: profileHere, noOpen: options.noOpen })",
    );
    expect(source).toContain("console.log(openYourselfLine());");
    expect(source).toContain("spawn: machine.spawnDetached,");
    // The starter and the server are the two shapes the bundle runs.
    expect(source).toContain("options.ensure");
    expect(source).toContain("runEnsure(paths, options.pluginDir)");
    expect(source).toContain("portalStarterArgv(");
  });

  test("the old refusal inside Claude Code is gone: there is no token to leak (D9)", () => {
    const source = readFileSync(join(import.meta.dir, "command.ts"), "utf8");
    expect(source).not.toContain("CLAUDECODE");
    expect(source).not.toContain("claudeCodeRefusal");
    expect(PORTAL_USAGE).not.toContain("refuses");
    // And what replaced it: the session-escape guard asks before a shell reaches the port.
    const guard = readFileSync(
      join(import.meta.dir, "..", "hooks", "session-escape-guard.ts"),
      "utf8",
    );
    expect(guard).toContain("DEFAULT_PORTAL_PORT");
  });
});

describe("portal status", () => {
  test("running: the address, the version and the pid, and exit 0", async () => {
    const machine = world({ state: { kind: "ours", pid: 12, version: VERSION } });
    expect(await machine.run(["status"])).toBe(0);
    expect(machine.printed).toEqual([
      `The portal is running at http://127.0.0.1:${PORT} (version ${VERSION}, process 12).`,
    ]);
    expect(machine.spawned).toEqual([]);
    expect(machine.opened).toEqual([]);
  });

  test("not running: one line with what starts it, and exit 1", async () => {
    const machine = world();
    expect(await machine.run(["status"])).toBe(1);
    expect(machine.printed.join("\n")).toContain("is not running");
    expect(machine.printed.join("\n")).toContain(`${COMMAND} portal`);
  });

  test("another program's port: said as such, and exit 1", async () => {
    const machine = world({ state: { kind: "other" } });
    expect(await machine.run(["status"])).toBe(1);
    expect(machine.printed.join("\n")).toContain("Another program holds");
  });
});

describe("portal stop", () => {
  test("running: its pid is signalled, and the line says it stopped", async () => {
    const machine = world({ state: { kind: "ours", pid: 8, version: VERSION } });
    expect(await machine.run(["stop"])).toBe(0);
    expect(machine.killed).toEqual([8]);
    expect(machine.printed).toEqual(["The portal stopped."]);
  });

  test("not running: nothing is signalled, and that is not an error", async () => {
    const machine = world();
    expect(await machine.run(["stop"])).toBe(0);
    expect(machine.killed).toEqual([]);
    expect(machine.printed).toEqual(["The portal is not running."]);
  });

  test("another program's port: never signalled", async () => {
    const machine = world({ state: { kind: "other" } });
    expect(await machine.run(["stop"])).toBe(1);
    expect(machine.killed).toEqual([]);
    expect(machine.errors.join("\n")).toContain("it is not this portal, so nothing was stopped");
  });
});

describe("the Windows start", () => {
  test("the server argv has no port: the one fixed port is the bundle's own (D10)", () => {
    expect(portalServerArgv("bun", "/d/portal.js", "/p")).toEqual([
      "bun",
      "--no-env-file",
      "--config=/p/bunfig.toml",
      "/d/portal.js",
      "--serve",
      "--plugin-dir",
      "/p",
    ]);
    expect(portalStarterArgv("bun", "/p/dist/portal.js", "/p")).toEqual([
      "bun",
      "--no-env-file",
      "--config=/p/bunfig.toml",
      "/p/dist/portal.js",
      "--ensure",
    ]);
  });
});

describe("the starter's source of the bundle (D10)", () => {
  /** A temp home whose installed_plugins.json records `version` at `install`, with a bundle or not. */
  function home(version: string, bundle: boolean) {
    const root = tempDir("portal-source");
    const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(root, ".claude"), HOME: root });
    const install = join(root, "cache", version);
    mkdirSync(join(install, "dist"), { recursive: true });
    if (bundle) writeFileSync(join(install, "dist", "portal.js"), "// the bundle\n");
    mkdirSync(join(paths.claudeConfigDir, "plugins"), { recursive: true });
    writeFileSync(
      paths.installedPluginsFile,
      `${JSON.stringify({
        plugins: {
          "cc-smart-dev-kit@cc-smart-dev-kit": [{ installPath: install, scope: "user", version }],
        },
        version: 2,
      })}\n`,
    );
    return { install, paths };
  }

  test("the installed version with its bundle is the source, with its version", () => {
    const world = home("1.1.0", true);
    expect(installedPluginFolder(world.paths, "/fallback")).toEqual({
      folder: world.install,
      source: "installed",
      version: "1.1.0",
    });
  });

  test("an installed version whose bundle is missing: the record's version still shows, so the starter can refuse", () => {
    // A half install: starting the old bundle here would be D10's forbidden downgrade.
    const world = home("1.1.0", false);
    expect(installedPluginFolder(world.paths, "/fallback")).toEqual({
      folder: "/fallback",
      source: "fallback",
      version: "1.1.0",
    });
  });

  test("no record at all: the fallback, and no version to compare", () => {
    const world = home("1.1.0", true);
    writeFileSync(world.paths.installedPluginsFile, '{"plugins":{},"version":2}\n');
    expect(installedPluginFolder(world.paths, "/fallback")).toEqual({
      folder: "/fallback",
      source: "fallback",
      version: null,
    });
  });

  test("the entry refuses to start a bundle older than the installed version", () => {
    // The starter reads it from the entry, which cannot be imported (it starts a server).
    const source = readFileSync(join(import.meta.dir, "..", "entries", "portal.ts"), "utf8");
    expect(source).toContain("isOlder(VERSION, installed.version)");
    expect(source).toContain('installed.source === "fallback"');
    expect(source).toContain("nothing was started");
  });
});
