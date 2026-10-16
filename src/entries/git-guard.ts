// The git-guard hook: plugin/dist/git-guard.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { gitGuardHook } from "../hooks/specs";

await runHookEntry(gitGuardHook);
