// The job-route hook: plugin/dist/job-route.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { jobRouteHook } from "../hooks/specs";

await runHookEntry(jobRouteHook);
