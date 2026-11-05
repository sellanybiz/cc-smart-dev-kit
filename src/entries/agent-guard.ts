// The agent-guard hook: plugin/dist/agent-guard.js. Its logic and tests live in src/hooks/.
// It alone loads the Workflow script parser, so acorn is in this bundle only (script-parser.ts).
import { runHookEntry } from "../hooks/run";
import { loadScriptParser } from "../hooks/script-parser";
import { agentGuardHook } from "../hooks/specs";

loadScriptParser();
await runHookEntry(agentGuardHook);
