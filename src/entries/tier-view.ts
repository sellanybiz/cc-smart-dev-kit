// The tier-view hook: plugin/dist/tier-view.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { tierViewHook } from "../hooks/specs";

await runHookEntry(tierViewHook);
