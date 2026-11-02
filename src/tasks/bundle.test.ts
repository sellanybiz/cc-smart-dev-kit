import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { cleanGitEnv, tempDir } from "../testing/temp";

const root = join(import.meta.dir, "../..");
test("CLI excludes the SDK and the server bundle includes it", async () => {
  const outdir = tempDir();
  for (const entry of ["cli", "tasks-mcp"]) {
    const result = await Bun.build({
      entrypoints: [join(root, "src/entries", `${entry}.ts`)],
      target: "bun",
      outdir,
    });
    expect(result.success).toBe(true);
  }
  const cli = readFileSync(join(outdir, "cli.js"), "utf8");
  const server = readFileSync(join(outdir, "tasks-mcp.js"), "utf8");
  expect(cli.match(/\bMcpServer\b/g)?.length ?? 0).toBe(0);
  expect(server.match(/\bMcpServer\b/g)?.length ?? 0).toBeGreaterThan(0);
});

/**
 * What one server process costs, measured on the BUILT bundle, the file a machine runs: from
 * source, bun's own transpiling adds about 30 MB that no machine ever pays.
 */
test.skipIf(process.platform !== "linux")(
  "the built server, initialized, stays below its memory budget",
  async () => {
    const home = tempDir();
    const outdir = tempDir();
    const built = await Bun.build({
      entrypoints: [join(root, "src/entries/tasks-mcp.ts")],
      target: "bun",
      outdir,
    });
    expect(built.success).toBe(true);
    const guard = subprocessGuard();
    const child = Bun.spawn([process.execPath, ...guard.args, join(outdir, "tasks-mcp.js")], {
      cwd: home,
      env: {
        ...cleanGitEnv(),
        ...guard.env,
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    try {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`,
      );
      child.stdin.flush();
      const response = await reader.read();
      expect(new TextDecoder().decode(response.value)).toContain('"id":1');
      const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
      const rss = Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1]);
      console.error(`Task MCP initialized VmRSS: ${rss} kB`);
      expect(rss).toBeGreaterThan(0);
      expect(rss).toBeLessThan(60 * 1024);
    } finally {
      reader.releaseLock();
      child.kill();
      await child.exited;
    }
  },
);
