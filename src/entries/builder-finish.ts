// The builder-finish hook: plugin/dist/builder-finish.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { builderFinishHook } from "../hooks/specs";

await runHookEntry(builderFinishHook);
