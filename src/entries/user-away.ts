// The user-away hook: plugin/dist/user-away.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { userAwayHook } from "../hooks/specs/user-away";

await runHookEntry(userAwayHook);
