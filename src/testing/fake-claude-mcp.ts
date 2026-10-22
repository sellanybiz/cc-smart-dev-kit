/**
 * The fake `claude mcp` a test's fake `claude` runs: it emulates Claude Code's own writes, so
 * setup's registration, doctor's check and restore's removal are exercised for real —
 * user-scope servers live in `<config dir>/.claude.json` under `mcpServers` (seen live,
 * 2.1.301). The text of a script, which the fake runs with bun: `bun <file> mcp <verb> …`.
 */
export const FAKE_CLAUDE_MCP_JS = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const file = join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude"), ".claude.json");
const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const argv = process.argv.slice(2);
const verb = argv[1];
const rest = argv.slice(2);
if (verb === "add-json") {
  const name = rest[rest.length - 2];
  const config = JSON.parse(rest[rest.length - 1]);
  const all = read();
  if (all.mcpServers?.[name] !== undefined) {
    console.error("MCP server " + name + " already exists in user config");
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify({ ...all, mcpServers: { ...all.mcpServers, [name]: config } }, null, 2));
  console.log("Added stdio MCP server " + name + " to user config");
  process.exit(0);
}
if (verb === "remove") {
  const name = rest[0];
  const all = read();
  if (all.mcpServers?.[name] === undefined) {
    console.error("No MCP server found with name: " + name);
    process.exit(1);
  }
  delete all.mcpServers[name];
  writeFileSync(file, JSON.stringify(all, null, 2));
  console.log("Removed MCP server " + name);
  process.exit(0);
}
if (verb === "get") {
  const name = rest[0];
  const config = read().mcpServers?.[name];
  if (config === undefined) {
    console.error("No MCP server found with name: " + name);
    process.exit(1);
  }
  console.log(name + ":");
  console.log("  Scope: User config (available in all your projects)");
  console.log("  Status: ✔ Connected");
  console.log("  Type: " + (config.type ?? "stdio"));
  process.exit(0);
}
process.exit(0);
`;
