// The worktree-remove hook: plugin/dist/worktree-remove.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { worktreeRemoveHook } from "../hooks/specs";

await runHookEntry(worktreeRemoveHook);
