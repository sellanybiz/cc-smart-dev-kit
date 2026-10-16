// The Serena root keeper hook: plugin/dist/serena-root.js, on PreToolUse, PostToolUse and
// PostToolUseFailure for `mcp__serena__activate_project`, and on SessionStart
// (plugin/hooks/hooks.json). It records which folder Serena edits for THIS session, so the
// main-folder guard can place a Serena edit (`serena-root.ts` has the whole contract).

import { runHookEntry } from "../hooks/run";
import { serenaRootHook } from "../hooks/specs";

await runHookEntry(serenaRootHook);
