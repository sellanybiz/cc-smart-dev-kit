/**
 * The browser MCP launcher (`launcher.ts`): the arguments it reads, the exact argv and environment
 * the Playwright MCP is started with, the refusal that keeps a session from ever opening an
 * approval page (no token → nothing is started), and the Chrome it starts itself when the first
 * browser call finds none running.
 *
 * Every Chrome here is a world of its own (`src/testing/chrome-world.ts`): a temp home with a fake
 * executable, so no test reads or starts the machine's real Chrome.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { chromeWorld, type ChromeWorld, writeWorldToken } from "../testing/chrome-world";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import type { DesktopEnvironment } from "./chrome-start";
import {
  type BrowserMcpDeps,
  browserMcpArgv,
  browserMcpOptions,
  noTokenMessage,
  runBrowserMcp,
} from "./launcher";
import { BROWSER_TOKEN_ENV } from "./token";

/** A Chrome world for the launcher, and whether a Chrome runs on that profile's folder. */
function world(
  options: { chrome?: boolean; extension?: boolean; profile?: boolean; running?: boolean } = {},
): { built: ChromeWorld; chromeDeps: BrowserMcpDeps["chrome"]; state: { running: boolean } } {
  const built = chromeWorld({ chrome: options.chrome ?? true });
  if (options.profile !== false) built.withProfile({ extension: options.extension ?? true });
  const state = { running: options.running ?? true };
  // Chrome's own `SingletonLock` names `<host>-<pid>` and is the one answer to "is Chrome
  // running"; a lock from before a restart names a pid that no longer runs.
  const chromeDeps: BrowserMcpDeps["chrome"] = {
    ...built.deps,
    hostname: () => hostname(),
    isAlive: () => state.running,
    readlink: () => (state.running ? `${hostname()}-4242` : null),
  };
  return { built, chromeDeps, state };
}

/** What the launcher starts, recorded: the MCP, and the person's Chrome. */
function launcher(
  built: ChromeWorld,
  chromeDeps: BrowserMcpDeps["chrome"],
  desktop: DesktopEnvironment = { display: true, source: "session", vars: { DISPLAY: ":0" } },
  chromeExit: { code: number; stderr: string } | null = null,
) {
  const mcp: { argv: string[]; env: Record<string, string>; cwd: string }[] = [];
  const chrome: { argv: string[]; env: Record<string, string> }[] = [];
  const lines: string[] = [];
  const deps: BrowserMcpDeps = {
    chrome: chromeDeps,
    desktop: () => desktop,
    env: { DISPLAY: ":0", PATH: "/usr/bin" },
    log: (line) => lines.push(line),
    spawn: (argv, options) => {
      mcp.push({ argv, cwd: options.cwd, env: options.env });
      return { exited: Promise.resolve(0), kill: () => undefined };
    },
    startChrome: (argv, env) => {
      chrome.push({ argv, env });
      return {
        exited: chromeExit === null ? new Promise<number>(() => undefined) : Promise.resolve(chromeExit.code),
        kill: () => undefined,
        stderr: () => chromeExit?.stderr ?? "",
      };
    },
    which: () => "/usr/bin/bunx",
  };
  return { chrome, deps, lines, mcp };
}

describe("the launcher's own arguments", () => {
  test("the output folder is its own; the rest goes to the MCP", () => {
    const read = browserMcpOptions(chromeWorld().paths, [
      "--output-dir=/tmp/other-output",
      "--caps=vision",
    ]);
    expect(read).toEqual({ mcpArgs: ["--caps=vision"], outputDir: "/tmp/other-output" });
  });

  test("without it: the plugin's own output folder", () => {
    const { built } = world();
    const read = browserMcpOptions(built.paths, []);
    expect(read.outputDir).toBe(join(built.home, ".local/share/cc-smart-dev-kit/playwright-output"));
    expect(read.mcpArgs).toEqual([]);
  });
});

describe("browserMcpArgv", () => {
  test("extension mode: the pinned package, the profile, the output folder, and the file switches", () => {
    const argv = browserMcpArgv(
      ["/usr/bin/bunx"],
      { mcpArgs: ["--caps=vision"], outputDir: "/out" },
      "@playwright/mcp@1.2.3",
      "claude-code",
    );
    expect(argv).toEqual([
      "/usr/bin/bunx",
      "-y",
      "@playwright/mcp@1.2.3",
      "--extension",
      "--browser=chrome",
      "--profile-dir-name=claude-code",
      "--output-dir=/out",
      `--output-max-size=${String(200 * 1024 * 1024)}`,
      "--file-paths=absolute",
      "--allow-unrestricted-file-access",
      "--caps=vision",
    ]);
    // The shared-browser mode's own machinery is gone, and nothing may bring it back: no CDP
    // endpoint (the filter's), no init page (the picker), no idle timeout, no headless.
    for (const gone of ["--cdp-endpoint", "--init-page", "--idle-timeout", "--headless"]) {
      expect(argv.some((arg) => arg.startsWith(gone))).toBe(false);
    }
  });
});

describe("runBrowserMcp", () => {
  test("no token: nothing is started — no Chrome and no MCP — and one line says the fix", async () => {
    const { built, chromeDeps } = world({ running: false });
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).not.toBe(0);
    expect(run.mcp).toHaveLength(0);
    expect(run.chrome).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("browser token");
    expect(run.lines[0]).toContain("approve every connection");
    expect(run.lines[0]).toContain(built.paths.browserTokenFile);
  });

  test("a token file with the wrong shape is refused like a missing one", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built, "half-a-token");
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).not.toBe(0);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines.join("\n")).toContain("does not hold the extension's token");
  });

  test("a token file others can read is refused", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built, "b".repeat(43));
    chmodSync(built.paths.browserTokenFile, 0o644);
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).not.toBe(0);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines.join("\n")).toContain("readable by others");
  });

  test("with a token: the MCP is started in extension mode, the token in its environment only", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, ["--caps=vision"], run.deps);
    expect(code).toBe(0);
    expect(run.chrome).toHaveLength(0); // Chrome was running: nothing started
    expect(run.mcp).toHaveLength(1);
    const started = run.mcp[0];
    expect(started?.argv.slice(0, 3)).toEqual(["/usr/bin/bunx", "-y", "@playwright/mcp@0.0.83"]);
    expect(started?.argv).toContain("--extension");
    expect(started?.argv).toContain("--profile-dir-name=claude-code");
    // The token never reaches a command line: `argv` is readable by every user on the machine.
    const token = `${"A".repeat(40)}_-b`;
    expect(started?.argv.some((arg) => arg.includes(token))).toBe(false);
    expect(started?.argv.some((arg) => arg.startsWith("--token"))).toBe(false);
    expect(started?.env).toEqual({ [BROWSER_TOKEN_ENV]: token });
    // The output folder is made owner-only before the MCP writes into it.
    expect(statSync(built.paths.browserOutputDir).mode & 0o777).toBe(0o700);
  });

  test("a loose output folder is tightened, with one line saying so", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built);
    mkdirSync(built.paths.browserOutputDir, { recursive: true });
    chmodSync(built.paths.browserOutputDir, 0o755);
    const run = launcher(built, chromeDeps);
    await runBrowserMcp(built.paths, [], run.deps);
    expect(statSync(built.paths.browserOutputDir).mode & 0o777).toBe(0o700);
    expect(run.lines.join("\n")).toContain("was readable by other users");
  });

  test("bunx missing: the MCP is started through this bun's own x", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    run.deps.which = () => null;
    await runBrowserMcp(built.paths, [], run.deps);
    expect(run.mcp[0]?.argv.slice(0, 2)).toEqual([process.execPath, "x"]);
  });

  test("PB-1: the MCP starts in the browser's own output folder, never the session's folder", async () => {
    const { built, chromeDeps } = world();
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    await runBrowserMcp(built.paths, [], run.deps);
    await runBrowserMcp(built.paths, ["--output-dir=/tmp/other-output"], run.deps);
    expect(run.mcp.map((one) => one.cwd)).toEqual([
      join(built.home, ".local/share/cc-smart-dev-kit/playwright-output"),
      "/tmp/other-output",
    ]);
  });

  test("PB-2: a profile made in Chrome's own dialog is the one the MCP is told", async () => {
    // Chrome's "Add profile" makes a folder `Profile 2` and keeps the name typed there in
    // `Local State`. `doctor` finds it by that name; the MCP must be told the same folder, or it
    // looks for `<user data>/claude-code` and fails while doctor shows ✓.
    const { built, chromeDeps } = world();
    const userData = built.userDataDir;
    rmSync(join(userData, "claude-code"), { force: true, recursive: true });
    mkdirSync(join(userData, "Profile 2", "Extensions", "mmlmfjhmonkocbjadbfplnigmagldckm"), {
      recursive: true,
    });
    writeFileSync(
      join(userData, "Local State"),
      JSON.stringify({ profile: { info_cache: { "Profile 2": { name: "claude-code" } } } }),
    );
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    await runBrowserMcp(built.paths, [], run.deps);
    expect(run.mcp[0]?.argv).toContain("--profile-dir-name=Profile 2");
    expect(run.mcp[0]?.argv).not.toContain("--profile-dir-name=claude-code");
  });

  test("no Chrome is running: it starts the found Chrome with the profile, then the MCP", async () => {
    const { built, chromeDeps, state } = world({ running: false });
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    const code = runBrowserMcp(built.paths, [], run.deps);
    await Bun.sleep(10);
    state.running = true; // Chrome takes its singleton lock while the launcher waits
    expect(await code).toBe(0);
    expect(run.chrome).toEqual([
      {
        argv: [
          built.chrome,
          "--profile-directory=claude-code",
          "--no-first-run",
          "--no-default-browser-check",
        ],
        // The desktop's variables, so Chrome can open a window from a session without one.
        env: { DISPLAY: ":0", PATH: "/usr/bin" },
      },
    ]);
    expect(run.mcp).toHaveLength(1);
  });

  test("no Chrome is running and Chrome cannot start: exit 2, one plain line, no MCP", async () => {
    const { built, chromeDeps } = world({ running: false });
    writeWorldToken(built);
    // What a session with no reachable display gets from Chrome itself.
    const run = launcher(built, chromeDeps, undefined, {
      code: 1,
      stderr: "Missing X server or $DISPLAY",
    });
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).toBe(2);
    expect(run.chrome).toHaveLength(1);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("exited at once (code 1: Missing X server or $DISPLAY)");
    expect(run.lines[0]).toContain("Open Google Chrome");
  });

  test("no Google Chrome on the machine: one line naming browser setup", async () => {
    const { built, chromeDeps } = world({ chrome: false, running: false });
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).toBe(2);
    expect(run.mcp).toHaveLength(0);
    expect(run.chrome).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("Google Chrome is not installed");
    expect(run.lines[0]).toContain("browser setup");
  });

  test("no claude-code profile: one line naming browser setup", async () => {
    const { built, chromeDeps } = world({ profile: false, running: false });
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).toBe(2);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain('the Chrome profile "claude-code" is not there');
    expect(run.lines[0]).toContain("browser setup");
  });

  test("the extension missing from the profile: one line naming browser setup", async () => {
    const { built, chromeDeps } = world({ extension: false, running: false });
    writeWorldToken(built);
    const run = launcher(built, chromeDeps);
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).toBe(2);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("Playwright extension is not installed");
    expect(run.lines[0]).toContain("browser setup");
  });

  test("no display for the person's desktop: one line, and nothing is started", async () => {
    const { built, chromeDeps } = world({ running: false });
    writeWorldToken(built);
    const run = launcher(built, chromeDeps, { display: false, source: "none", vars: {} });
    const code = await runBrowserMcp(built.paths, [], run.deps);
    expect(code).toBe(2);
    expect(run.chrome).toHaveLength(0);
    expect(run.mcp).toHaveLength(0);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("no desktop display");
    expect(run.lines[0]).toContain("Open Google Chrome");
  });
});

describe("PB-1: the real command, from a project with its own bunfig.toml", () => {
  test("PB-1: a project's bunfig.toml preload never runs inside the browser MCP", async () => {
    // Claude Code starts `browser mcp` in the session's folder. Bun reads the working folder's
    // `bunfig.toml` (its `preload`) and `.env` for every bun it starts, and bunx looks in its
    // `node_modules` first: so the MCP child, which holds the browser token, would run the
    // project's own code. The fake bunx starts a real bun, exactly as bunx would.
    const world_ = world();
    writeWorldToken(world_.built);
    // A Chrome is running on that profile's folder: the launcher connects to it, and never starts
    // the machine's real Chrome.
    symlinkSync(`${hostname()}-${String(process.pid)}`, join(world_.built.userDataDir, "SingletonLock"));
    const project = tempDir("browser-mcp-project");
    const marker = join(project, "preload-ran");
    writeFileSync(
      join(project, "preload.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`,
    );
    writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
    const bin = join(world_.built.home, "fake-bin");
    mkdirSync(bin, { recursive: true });
    const probe = join(world_.built.home, "probe.js");
    const seen = join(world_.built.home, "probe-cwd");
    writeFileSync(
      probe,
      `require("node:fs").writeFileSync(${JSON.stringify(seen)}, process.cwd());\n`,
    );
    writeFileSync(join(bin, "bunx"), `#!/bin/sh\nexec "${process.execPath}" "${probe}"\n`);
    chmodSync(join(bin, "bunx"), 0o755);
    const plugin = join(import.meta.dir, "..", "..", "plugin");
    const guard = subprocessGuard();
    // Started the way the launcher starts the CLI: the plugin's own empty config, no `.env`.
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        `--config=${join(plugin, "bunfig.toml")}`,
        ...guard.args,
        join(import.meta.dir, "..", "entries", "cli.ts"),
        "browser",
        "mcp",
      ],
      {
        cwd: project,
        env: {
          CLAUDE_CONFIG_DIR: join(world_.built.home, ".claude"),
          HOME: world_.built.home,
          PATH: bin,
          ...guard.env,
        },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      },
    );
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(seen, "utf8")).toBe(world_.built.paths.browserOutputDir);
  });
});

describe("noTokenMessage", () => {
  test("it names the reason, the fix, and the token file — never a token", () => {
    const message = noTokenMessage(chromeWorld().paths, "no token file at /x");
    expect(message).toContain("no token file at /x");
    expect(message).toContain("browser setup");
    expect(message).toContain("browser token");
  });
});
