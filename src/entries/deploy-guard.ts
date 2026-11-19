// The deploy-guard hook: plugin/dist/deploy-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { deployGuardHook } from "../hooks/specs";

await runHookEntry(deployGuardHook);
