/**
 * The browser MCP launcher (`launcher.ts`): the arguments it reads, the picker it writes,
 * and the Playwright MCP it starts against the shared Chrome through the filter.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import type { TabFilterServer } from "./cdp-tab-filter-server";
import { browserMcpOptions, installPicker, runBrowserMcp } from "./launcher";

function paths(home: string) {
  return cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
}

describe("the launcher's own arguments", () => {
  test("the shared profile, the output folder and the lock port are its own; the rest goes to the MCP", () => {
    const home = tempDir("browser-args");
    const read = browserMcpOptions(paths(home), [
      "--shared-profile=/tmp/other-profile",
      "--output-dir=/tmp/other-output",
      "--start-lock-port=27650",
      "--headless",
      "--caps=vision",
    ]);
    expect(read).toEqual({
      headless: true,
      lockPort: 27650,
      mcpArgs: ["--caps=vision"],
      outputDir: "/tmp/other-output",
      profileDir: "/tmp/other-profile",
    });
  });

  test("without them: the shared profile and output folder, and the fixed start-lock port", () => {
    const home = tempDir("browser-args");
    const read = browserMcpOptions(paths(home), []);
    expect(read.profileDir).toBe(join(home, ".local/share/cc-smart-dev-kit/playwright"));
    expect(read.outputDir).toBe(join(home, ".local/share/cc-smart-dev-kit/playwright-output"));
    expect(read.lockPort).toBe(27640);
    expect(read.headless).toBe(false);
    expect(read.mcpArgs).toEqual([]);
  });

  test("a lock port that is not a number is refused", () => {
    const home = tempDir("browser-args");
    expect(() => browserMcpOptions(paths(home), ["--start-lock-port=soon"])).toThrow(
      "--start-lock-port= needs a port number",
    );
  });
});

describe("installPicker", () => {
  test("it writes the plugin's bundle beside the profile, and only when it changed", () => {
    const dir = tempDir("browser-picker");
    const source = join(dir, "browser-picker.js");
    const target = join(dir, "data", "playwright-picker.js");
    writeFileSync(source, "export default 1;\n");
    installPicker(target, source);
    expect(readFileSync(target, "utf8")).toBe("export default 1;\n");

    // The same content again: no write (the mtime proves it).
    const before = readFileSync(target).length;
    writeFileSync(target, "export default 1;\n");
    installPicker(target, source);
    expect(readFileSync(target).length).toBe(before);

    writeFileSync(source, "export default 2;\n");
    installPicker(target, source);
    expect(readFileSync(target, "utf8")).toBe("export default 2;\n");

    // A plugin without the bundle writes nothing (the file that is there stays).
    installPicker(target, join(dir, "not-there.js"));
    expect(readFileSync(target, "utf8")).toBe("export default 2;\n");
  });
});

describe("runBrowserMcp", () => {
  test("it starts the MCP against the filter, with the downloads folder and the init page", async () => {
    const home = tempDir("browser-mcp");
    const pickerBundle = join(home, "picker.js");
    writeFileSync(pickerBundle, "export default 1;\n");
    const spawned: string[][] = [];
    let closed = 0;
    const filter: TabFilterServer = {
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
      endpoint: "ws://127.0.0.1:5555/",
    };
    let exitNow: ((code: number) => void) | undefined;
    const running = runBrowserMcp(paths(home), ["--headless", "--caps=vision"], {
      installPicker,
      log: () => undefined,
      package: "@playwright/mcp@1.2.3",
      pickerBundle,
      serve: (options) => {
        expect(options.downloadsPath).toBe(
          join(home, ".local/share/cc-smart-dev-kit/playwright-output/traces"),
        );
        return filter;
      },
      spawn: (argv) => {
        spawned.push(argv);
        return {
          exited: new Promise<number>((done) => {
            exitNow = done;
          }),
          kill: () => undefined,
        };
      },
      which: (command) => (command === "bunx" ? "/usr/local/bin/bunx" : null),
    });
    // The launcher hands the MCP stream straight on, so it waits for the child; the child
    // has been started by now.
    await Bun.sleep(10);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toEqual([
      "/usr/local/bin/bunx",
      "-y",
      "@playwright/mcp@1.2.3",
      "--cdp-endpoint=ws://127.0.0.1:5555/",
      `--idle-timeout=${String(10 * 60 * 1000)}`,
      `--output-dir=${join(home, ".local/share/cc-smart-dev-kit/playwright-output")}`,
      `--output-max-size=${String(200 * 1024 * 1024)}`,
      "--file-paths=absolute",
      "--allow-unrestricted-file-access",
      `--init-page=${join(home, ".local/share/cc-smart-dev-kit/playwright-picker.js")}`,
      "--caps=vision",
    ]);
    expect(closed).toBe(0);
    // An `--idle-timeout` from the registered arguments wins over the launcher's own.
    (exitNow as unknown as (code: number) => void)(0);
    expect(await running).toBe(0);
    expect(closed).toBe(1);
    expect(
      readFileSync(join(home, ".local/share/cc-smart-dev-kit/playwright-picker.js"), "utf8"),
    ).toBe("export default 1;\n");
  });

  test("no bunx on PATH: the bun running this starts the MCP, and the passed idle timeout wins", async () => {
    const home = tempDir("browser-mcp");
    const spawned: string[][] = [];
    let exitNow: ((code: number) => void) | undefined;
    const running = runBrowserMcp(paths(home), ["--idle-timeout=5000"], {
      installPicker: () => undefined,
      log: () => undefined,
      package: "@playwright/mcp@1.2.3",
      pickerBundle: join(home, "picker.js"),
      serve: () => ({ close: () => Promise.resolve(), endpoint: "ws://127.0.0.1:1/" }),
      spawn: (argv) => {
        spawned.push(argv);
        return {
          exited: new Promise<number>((done) => {
            exitNow = done;
          }),
          kill: () => undefined,
        };
      },
      which: () => null,
    });
    await Bun.sleep(10);
    expect(spawned[0]?.slice(0, 4)).toEqual([process.execPath, "x", "-y", "@playwright/mcp@1.2.3"]);
    expect(spawned[0]).toContain("--idle-timeout=5000");
    expect(spawned[0]).not.toContain(`--idle-timeout=${String(10 * 60 * 1000)}`);
    (exitNow as unknown as (code: number) => void)(0);
    expect(await running).toBe(0);
  });
});
