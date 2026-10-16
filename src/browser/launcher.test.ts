/**
 * The browser MCP launcher (`launcher.ts`): the arguments it reads, the exact argv and environment
 * the Playwright MCP is started with, and the refusal that keeps a session from ever opening an
 * approval page (no token → nothing is started).
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { browserMcpArgv, browserMcpOptions, noTokenMessage, runBrowserMcp } from "./launcher";
import { BROWSER_TOKEN_ENV } from "./token";

function paths(home: string) {
  return cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
}

/** A token file the launcher can read: 0600, with the extension's own shape. */
function tokenFile(home: string, token = "a".repeat(43)): void {
  const paths_ = paths(home);
  mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true, mode: 0o700 });
  writeFileSync(paths_.browserTokenFile, `${token}\n`, { mode: 0o600 });
}

describe("the launcher's own arguments", () => {
  test("the output folder is its own; the rest goes to the MCP", () => {
    const home = tempDir("browser-args");
    const read = browserMcpOptions(paths(home), [
      "--output-dir=/tmp/other-output",
      "--caps=vision",
    ]);
    expect(read).toEqual({ mcpArgs: ["--caps=vision"], outputDir: "/tmp/other-output" });
  });

  test("without it: the plugin's own output folder", () => {
    const home = tempDir("browser-args");
    const read = browserMcpOptions(paths(home), []);
    expect(read.outputDir).toBe(join(home, ".local/share/cc-smart-dev-kit/playwright-output"));
    expect(read.mcpArgs).toEqual([]);
  });
});

describe("browserMcpArgv", () => {
  test("extension mode: the pinned package, the profile, the output folder, and the file switches", () => {
    const argv = browserMcpArgv(
      ["/usr/bin/bunx"],
      { mcpArgs: ["--caps=vision"], outputDir: "/out" },
      "@playwright/mcp@1.2.3",
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
  test("no token: nothing is started, and one line says which command fixes it", async () => {
    const home = tempDir("browser-mcp");
    const lines: string[] = [];
    let started = 0;
    const code = await runBrowserMcp(paths(home), [], {
      log: (line) => lines.push(line),
      spawn: () => {
        started += 1;
        return { exited: Promise.resolve(0), kill: () => undefined };
      },
      which: () => "/usr/bin/bunx",
    });
    expect(code).not.toBe(0);
    expect(started).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("browser token");
    expect(lines[0]).toContain("approve every connection");
    expect(lines[0]).toContain(paths(home).browserTokenFile);
  });

  test("a token file with the wrong shape is refused like a missing one", async () => {
    const home = tempDir("browser-mcp");
    tokenFile(home, "half-a-token");
    const lines: string[] = [];
    const code = await runBrowserMcp(paths(home), [], {
      log: (line) => lines.push(line),
      spawn: () => {
        throw new Error("nothing may be started");
      },
      which: () => "/usr/bin/bunx",
    });
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("does not hold the extension's token");
  });

  test("a token file others can read is refused", async () => {
    const home = tempDir("browser-mcp");
    const paths_ = paths(home);
    tokenFile(home);
    writeFileSync(paths_.browserTokenFile, `${"b".repeat(43)}\n`);
    chmodSync(paths_.browserTokenFile, 0o644);
    const lines: string[] = [];
    const code = await runBrowserMcp(paths_, [], {
      log: (line) => lines.push(line),
      spawn: () => {
        throw new Error("nothing may be started");
      },
      which: () => "/usr/bin/bunx",
    });
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("readable by others");
  });

  test("with a token: the MCP is started in extension mode, the token in its environment only", async () => {
    const home = tempDir("browser-mcp");
    tokenFile(home);
    const paths_ = paths(home);
    const spawned: string[][] = [];
    const envs: Record<string, string>[] = [];
    const code = await runBrowserMcp(paths_, ["--caps=vision"], {
      log: () => undefined,
      spawn: (argv, options) => {
        spawned.push(argv);
        envs.push(options.env);
        return { exited: Promise.resolve(0), kill: () => undefined };
      },
      which: () => "/usr/bin/bunx",
    });
    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.slice(0, 3)).toEqual(["/usr/bin/bunx", "-y", "@playwright/mcp@0.0.83"]);
    expect(spawned[0]).toContain("--extension");
    expect(spawned[0]).toContain("--profile-dir-name=claude-code");
    // The token never reaches a command line: `argv` is readable by every user on the machine.
    const token = "a".repeat(43);
    expect(spawned[0]?.some((arg) => arg.includes(token))).toBe(false);
    expect(spawned[0]?.some((arg) => arg.startsWith("--token"))).toBe(false);
    expect(envs[0]).toEqual({ [BROWSER_TOKEN_ENV]: token });
    // The output folder is made owner-only before the MCP writes into it.
    expect(statSync(paths_.browserOutputDir).mode & 0o777).toBe(0o700);
  });

  test("a loose output folder is tightened, with one line saying so", async () => {
    const home = tempDir("browser-mcp");
    tokenFile(home);
    const paths_ = paths(home);
    mkdirSync(paths_.browserOutputDir, { recursive: true });
    chmodSync(paths_.browserOutputDir, 0o755);
    const lines: string[] = [];
    await runBrowserMcp(paths_, [], {
      log: (line) => lines.push(line),
      spawn: () => ({ exited: Promise.resolve(0), kill: () => undefined }),
      which: () => "/usr/bin/bunx",
    });
    expect(statSync(paths_.browserOutputDir).mode & 0o777).toBe(0o700);
    expect(lines.join("\n")).toContain("was readable by other users");
  });

  test("bunx missing: the MCP is started through this bun's own x", async () => {
    const home = tempDir("browser-mcp");
    tokenFile(home);
    const spawned: string[][] = [];
    await runBrowserMcp(paths(home), [], {
      log: () => undefined,
      spawn: (argv) => {
        spawned.push(argv);
        return { exited: Promise.resolve(0), kill: () => undefined };
      },
      which: () => null,
    });
    expect(spawned[0]?.slice(0, 2)).toEqual([process.execPath, "x"]);
  });
});

describe("noTokenMessage", () => {
  test("it names the reason, the fix, and the token file — never a token", () => {
    const home = tempDir("browser-mcp");
    const message = noTokenMessage(paths(home), "no token file at /x");
    expect(message).toContain("no token file at /x");
    expect(message).toContain("browser setup");
    expect(message).toContain("browser token");
  });
});
