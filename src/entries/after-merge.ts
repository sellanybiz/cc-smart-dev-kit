// The after-merge hook: plugin/dist/after-merge.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { afterMergeHook } from "../hooks/specs/after-merge";

await runHookEntry(afterMergeHook);
