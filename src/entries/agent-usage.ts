// The agent-usage hook: plugin/dist/agent-usage.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { agentUsageHook } from "../hooks/specs/agent-usage";

await runHookEntry(agentUsageHook);
