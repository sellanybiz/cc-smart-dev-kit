// The agent-guard hook: plugin/dist/agent-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { agentGuardHook } from "../hooks/specs";

await runHookEntry(agentGuardHook);
