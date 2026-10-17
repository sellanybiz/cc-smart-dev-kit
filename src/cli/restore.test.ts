/**
 * `cc-smart-dev-kit restore` and the MCP servers setup registered: what happens to the record
 * of them when it cannot be read, or when a server cannot be taken back. Run in this process,
 * with a fake `claude` and no router (service "none"); nothing reaches a real tool.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HealthProbe } from "../gateway/health";
import { mcpRecordsFile, recordMcpServer } from "../mcp/records";
import { capturePrinted, printed } from "../testing/fake-machine";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { type RestoreOptions, runRestore } from "./restore";

capturePrinted();

/** A probe that is never asked: there is no router here. */
const probe: HealthProbe = {
  fetch: () => Promise.reject(new Error("no router in this test")),
  now: () => 0,
  sleep: () => Promise.resolve(),
};

function machine() {
  const home = tempDir("cli-restore");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  mkdirSync(paths.stateDir, { recursive: true });
  const calls: string[] = [];
  const options = (claudeOk: boolean): RestoreOptions => ({
    yes: true,
    now: false,
    cliBundle: join(home, "plugin", "dist", "cli.js"),
    runner: () => ({ exitCode: 0, output: "" }),
    service: "none",
    confirm: null,
    probe,
    claude: (argv) => {
      calls.push(argv.join(" "));
      return claudeOk ? { ok: true, out: "" } : { ok: false, out: "claude: it failed" };
    },
    which: () => "/usr/bin/claude",
  });
  return { calls, home, options, paths };
}

describe("restore: the record of the MCP servers", () => {
  test("ST-5: a record that cannot be read stays, nothing is removed, and restore fails", async () => {
    const { calls, options, paths } = machine();
    const file = mcpRecordsFile(paths.stateDir);
    writeFileSync(file, "{not json");
    expect(await runRestore(paths, options(true))).toBe(1);
    // The file may still say what setup registered: it is the person's to fix, never deleted.
    expect(readFileSync(file, "utf8")).toBe("{not json");
    expect(calls).toEqual([]);
    expect(printed.join("\n")).toContain(
      "! cannot read ~/.claude/cc-smart-dev-kit/mcp-servers.json (",
    );
    expect(printed.join("\n")).not.toContain("removed (the record of the MCP servers)");
  });

  test("ST-12: a server whose removal failed makes restore fail, and its record stays", async () => {
    const { calls, options, paths } = machine();
    const json = JSON.stringify({ args: ["-y", "a-server@1.0.0"], command: "bunx" });
    recordMcpServer(paths.stateDir, "sequential-thinking", json, "then");
    mkdirSync(dirname(paths.userConfigFile), { recursive: true });
    writeFileSync(
      paths.userConfigFile,
      JSON.stringify({ mcpServers: { "sequential-thinking": JSON.parse(json) } }),
    );
    expect(await runRestore(paths, options(false))).toBe(1);
    expect(calls).toEqual(["claude mcp remove sequential-thinking --scope user"]);
    expect(existsSync(mcpRecordsFile(paths.stateDir))).toBe(true);
    expect(printed.join("\n")).toContain(
      "! $ claude mcp remove sequential-thinking --scope user failed (claude: it failed): the server is still registered",
    );
    // A later restore whose removal works: done, exit 0, and the record goes.
    expect(await runRestore(paths, options(true))).toBe(0);
    expect(existsSync(mcpRecordsFile(paths.stateDir))).toBe(false);
  });
});
