// The message-guard hook: plugin/dist/message-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { messageGuardHook } from "../hooks/specs";

await runHookEntry(messageGuardHook);
