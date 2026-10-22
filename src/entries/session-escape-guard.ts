// The session-escape-guard hook: plugin/dist/session-escape-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { sessionEscapeGuardHook } from "../hooks/specs";

await runHookEntry(sessionEscapeGuardHook);
