// The keep-going hook: plugin/dist/keep-going.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { keepGoingHook } from "../hooks/specs";

await runHookEntry(keepGoingHook);
