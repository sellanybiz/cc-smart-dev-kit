// The subagent-background hook: plugin/dist/subagent-background.js. Its logic and tests live
// in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { subagentBackgroundHook } from "../hooks/specs";

await runHookEntry(subagentBackgroundHook);
