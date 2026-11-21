// The worktree-leftovers hook: plugin/dist/worktree-leftovers.js. Its logic and tests live in src/hooks/.
import { runHookEntry } from "../hooks/run";
import { worktreeLeftoversHook } from "../hooks/specs/worktree-leftovers";

await runHookEntry(worktreeLeftoversHook);
