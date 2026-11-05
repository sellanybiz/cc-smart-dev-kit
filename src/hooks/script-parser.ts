/**
 * The one module that imports acorn, the JavaScript parser the agent guard reads Workflow scripts
 * with (`workflow-script.ts`). Only the agent guard's entry (`src/entries/agent-guard.ts`) and the
 * tests that judge a script import it, so acorn is bundled into `plugin/dist/agent-guard.js`
 * alone: every other hook bundle, and the CLI, carry the guard's code through the hook table but
 * never run it (`.claude/rules/bundles-and-releases.md` § Dependencies).
 */
import { parse } from "acorn";
import { useScriptParser } from "./workflow-script";

/** Hands acorn to the Workflow script reader. */
export function loadScriptParser(): void {
  useScriptParser(parse);
}
