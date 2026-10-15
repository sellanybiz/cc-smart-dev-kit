// The worktree-create hook: plugin/dist/worktree-create.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { worktreeCreateHook } from "../hooks/specs";

await runHookEntry(worktreeCreateHook);
