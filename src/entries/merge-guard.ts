// The merge guard hook: plugin/dist/merge-guard.js. Its logic and tests live in
// src/hooks/merge-guard.ts, with the policy it reads in src/workflow/.
import { runHookEntry } from "../hooks/run";
import { mergeGuardHook } from "../hooks/specs";

await runHookEntry(mergeGuardHook);
