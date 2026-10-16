// The review-record hook: plugin/dist/review-record.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { reviewRecordHook } from "../hooks/specs";

await runHookEntry(reviewRecordHook);
