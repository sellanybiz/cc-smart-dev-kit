// The main-folder-guard hook: plugin/dist/main-folder-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { mainFolderGuardHook } from "../hooks/specs";

await runHookEntry(mainFolderGuardHook);
