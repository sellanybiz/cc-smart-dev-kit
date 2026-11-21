// The session-name hook: plugin/dist/session-name.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { sessionNameHook } from "../hooks/specs/session-name";

await runHookEntry(sessionNameHook);
