// The crew-role hook: plugin/dist/crew-role.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { crewRoleHook } from "../hooks/specs";

await runHookEntry(crewRoleHook);
