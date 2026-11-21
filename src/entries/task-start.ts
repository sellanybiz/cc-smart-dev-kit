import { runHookEntry } from "../hooks/run";
import { taskStartHook } from "../hooks/specs/task-start";

await runHookEntry(taskStartHook);
