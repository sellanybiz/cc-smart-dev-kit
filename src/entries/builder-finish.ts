// The builder-finish hook: plugin/dist/builder-finish.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { builderFinishHook } from "../hooks/specs/builder-finish";

await runHookEntry(builderFinishHook);
