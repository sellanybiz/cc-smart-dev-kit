// The subagent-stop hook: plugin/dist/subagent-stop.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { subagentStopHook } from "../hooks/specs";

await runHookEntry(subagentStopHook);
