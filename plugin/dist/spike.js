// Phase 0 spike: log what a plugin hook sees — the event, the hook input's cwd, and the
// plugin variables — to a file. Prints nothing on stdout, so it changes no behaviour.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const event = process.argv[2] ?? "unknown";
const input = await Bun.stdin.text();
let parsed = {};
try {
  parsed = JSON.parse(input);
} catch {
  parsed = { unparsed: input.slice(0, 200) };
}
const dir = process.env.CLAUDE_PLUGIN_DATA || "/tmp/cc-spike";
mkdirSync(dir, { recursive: true });
const line = {
  at: new Date().toISOString(),
  event,
  inputCwd: parsed.cwd ?? null,
  inputEvent: parsed.hook_event_name ?? null,
  tool: parsed.tool_name ?? null,
  projectDir: process.env.CLAUDE_PROJECT_DIR ?? null,
  pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,
  pluginData: process.env.CLAUDE_PLUGIN_DATA ?? null,
  processCwd: process.cwd(),
};
appendFileSync(join(dir, "spike.log"), `${JSON.stringify(line)}\n`);
