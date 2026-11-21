// The verify-gate hook: plugin/dist/verify-gate.js. Its logic and tests live in
// src/hooks/.
import { runHookEntry } from "../hooks/run";
import { verifyGateHook } from "../hooks/specs/verify-gate";

await runHookEntry(verifyGateHook);
