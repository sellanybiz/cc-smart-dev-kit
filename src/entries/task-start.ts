import { runHookEntry } from "../hooks/run";
import { taskStartHook } from "../hooks/specs";

await runHookEntry(taskStartHook);
