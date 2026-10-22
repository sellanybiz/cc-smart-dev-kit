// The lead-notes hook: plugin/dist/lead-notes.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { leadNotesHook } from "../hooks/specs";

await runHookEntry(leadNotesHook);
